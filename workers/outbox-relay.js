// JALANKAN SATU INSTANCE SAJA. Kalau 2 instance relay jalan bersamaan, FOR UPDATE SKIP LOCKED
// di bawah mencegah mereka mengambil baris yang sama (tidak akan duplikat terkirim),
// tapi tetap tidak ada jaminan urutan antar 2 instance yang mengirim ke topic yang sama.
require("dotenv").config();
const pool = require("../src/config/pg");
const kafka = require("../src/config/kafka");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.OUTBOX_POLL_MS) || 1000;
let running = true;

async function relayOnce(producer, batch = 50) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE SKIP LOCKED: kalau (secara tidak sengaja) ada relay lain yang sedang
    // memproses baris ini, baris itu DILEWATI, bukan ditunggu — mencegah 2 relay saling blokir.
    const { rows } = await client.query(
      `SELECT id, event_id, topic, key, payload, headers, created_at FROM outbox_events
       WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batch],
    );

    if (!rows.length) {
      await client.query("COMMIT");
      return 0;
    }

    // Kelompokkan per topic supaya bisa dikirim sebagai satu sendBatch (lebih efisien
    // daripada producer.send() satu-satu per pesan).
    const byTopic = new Map();
    for (const r of rows) {
      const rid = (r.headers && r.headers["x-request-id"]) || "";
      const envelope = {
        eventId: r.event_id,
        type: r.payload.type || r.topic,
        version: 1,
        occurredAt: r.created_at,
        requestId: rid,
        payload: r.payload,
      };
      const list = byTopic.get(r.topic) || [];
      list.push({
        key: r.key,
        value: JSON.stringify(envelope),
        headers: { "x-request-id": String(rid) },
      });
      byTopic.set(r.topic, list);
    }

    await producer.sendBatch({
      topicMessages: [...byTopic].map(([topic, messages]) => ({
        topic,
        messages,
      })),
    });

    // BARU: log per event yang baru di-relay, supaya requestId bisa ditelusuri sampai ke sini.
    for (const r of rows) {
      const rid = (r.headers && r.headers["x-request-id"]) || "-";
      console.log(
        `${new Date().toISOString()} [${rid}] ${r.topic} ${r.payload.type || r.topic} ${r.key} -> relayed`,
      );
    }

    // Catatan jujur soal keandalan: kalau proses crash PERSIS di antara sendBatch berhasil
    // dan UPDATE ini, pesan itu akan terkirim ULANG di polling berikutnya (karena published_at
    // masih NULL). Ini "at-least-once delivery" — bukan bug, tapi konsekuensi sadar dari desain
    // outbox pattern. Itu sebabnya SEMUA consumer nanti (Fase 10+) WAJIB idempotent.
    await client.query(
      "UPDATE outbox_events SET published_at = now() WHERE id = ANY($1)",
      [rows.map((r) => r.id)],
    );

    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  // idempotent + maxInFlightRequests:1 -> producer Kafka tidak akan mengirim pesan duplikat
  // akibat retry internalnya sendiri (beda dengan isu crash di atas, yang levelnya aplikasi, bukan network).
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  await producer.connect();

  while (running) {
    try {
      if ((await relayOnce(producer)) === 0) {
        await sleep(POLL_MS);
      }
    } catch (err) {
      console.error("relay gagal:", err.message);
      await sleep(3000); // Kafka mungkin lagi down — tunggu lebih lama sebelum coba lagi
    }
  }

  await producer.disconnect();
  await pool.end();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    running = false;
  });
}

main();
