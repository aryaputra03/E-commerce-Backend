require("dotenv").config();
const pool = require("../src/config/pg");
const kafka = require("../src/config/kafka");
const runWithDlq = require("../src/kafka/runWithDlq");

const NOTIFY_WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

// Idempotent: penanda "sudah diproses" DAN efeknya (log/notifikasi) terjadi dalam SATU transaksi pg.
// Kafka itu "at-least-once delivery" — pesan yang sama BISA datang lebih dari sekali (karena crash
// di relay, rebalance consumer, dll). ON CONFLICT DO NOTHING di sini yang membuat pesan kedua
// untuk eventId yang sama tidak menghasilkan notifikasi kedua.
async function handle(env) {
  const { type, orderId, userId, status, totalAmount } = env.payload;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ins = await client.query(
      `INSERT INTO processed_events (consumer, event_id) VALUES ('notification', $1)
       ON CONFLICT DO NOTHING`,
      [env.eventId],
    );

    if (ins.rowCount === 0) {
      // Event ini SUDAH pernah diproses -> duplikat, diamkan tanpa efek.
      await client.query("COMMIT");
      return;
    }

    console.log(
      `${new Date().toISOString()} [${env.requestId}] NOTIF ${type} order=${orderId} user=${userId} status=${status} total=${totalAmount}`,
    );

    if (NOTIFY_WEBHOOK_URL) {
      try {
        await fetch(NOTIFY_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, orderId, userId, status, totalAmount }),
        });
      } catch (webhookErr) {
        // Gagal kirim ke webhook EKSTERNAL tidak membatalkan transaksi ini — notifikasi
        // internal (log + penanda di processed_events) tetap berhasil. Kirim ke pihak ketiga
        // adalah best-effort, bukan bagian dari jaminan konsistensi data kita.
        console.error("Gagal kirim NOTIFY_WEBHOOK_URL:", webhookErr.message);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err; // dilempar balik ke runWithDlq -> retry atau DLQ, sesuai jenis errornya
  } finally {
    client.release();
  }
}

async function main() {
  const consumer = kafka.consumer({ groupId: "notification-order" });
  const dlqProducer = kafka.producer(); // producer terpisah, khusus kirim ke topic .dlq

  await consumer.connect();
  await dlqProducer.connect();
  await consumer.subscribe({ topic: "order.events", fromBeginning: true });

  console.log("[notification] Worker siap, mendengarkan topic order.events...");

  await runWithDlq({ consumer, producer: dlqProducer, handle });

  const shutdown = async () => {
    console.log("[notification] Shutdown...");
    await consumer.disconnect();
    await dlqProducer.disconnect();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[notification] Gagal start:", err.message);
  process.exit(1);
});
