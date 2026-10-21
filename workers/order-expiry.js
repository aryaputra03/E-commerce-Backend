// Worker ini dijalankan TERPISAH dari server utama (node workers/order-expiry.js),
// bukan lewat npm run dev. Tugasnya: cari order 'pending' yang sudah lewat batas waktu,
// batalkan lewat transitionOrder yang sama dipakai webhook & admin (jadi stok pasti
// dikembalikan dengan cara yang konsisten).
require("dotenv").config();
const pool = require("../src/config/pg");
const { transitionOrder } = require("../src/services/orderStatus.service");

// +5 menit jeda dari waktu expiry Midtrans sendiri — mencegah worker ini "balapan" dengan
// webhook settlement yang mungkin baru saja datang hampir bersamaan dengan waktu kedaluwarsa.
const EXPIRY_MINUTES = (Number(process.env.ORDER_EXPIRY_MINUTES) || 60) + 5;
const POLL_INTERVAL_MS = 60000; // cek tiap 1 menit

async function expireOnce() {
  const { rows } = await pool.query(
    `SELECT id FROM orders WHERE status = 'pending'
     AND created_at < now() - make_interval(mins => $1)
     ORDER BY created_at LIMIT 50`,
    [EXPIRY_MINUTES],
  );

  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // onlyFrom: 'pending' WAJIB — mencegah worker ini membatalkan order yang statusnya
      // baru saja berubah jadi 'paid' TEPAT di antara query SELECT di atas dan baris ini.
      const result = await transitionOrder(client, id, "cancelled", {
        source: "expiry",
        onlyFrom: "pending",
      });
      await client.query("COMMIT");

      if (result.ok && result.changed) {
        console.log(
          `[expiry] Order ${id} dibatalkan karena kedaluwarsa, stok dikembalikan`,
        );
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[expiry] Gagal memproses order ${id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

console.log(
  `[expiry] Worker order-expiry berjalan, cek tiap ${POLL_INTERVAL_MS / 1000} detik`,
);

// Jalankan sekali SEGERA saat start (jangan nunggu interval pertama) — supaya mudah dites manual.
expireOnce().catch((err) =>
  console.error("[expiry] Error tidak terduga:", err.message),
);

const intervalId = setInterval(() => {
  expireOnce().catch((err) =>
    console.error("[expiry] Error tidak terduga:", err.message),
  );
}, POLL_INTERVAL_MS);

function shutdown() {
  console.log("[expiry] Worker dihentikan");
  clearInterval(intervalId);
  pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
