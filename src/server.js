require("dotenv").config();
const app = require("./app");
const pool = require("./config/pg");
const redis = require("./config/redis");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`Server berjalan di http://localhost:${PORT}`);
});

// Urutan ini penting: server.close() dulu (berhenti terima request BARU, tapi biarkan
// request yang SEDANG berjalan selesai), baru tutup pool pg & Redis. Kalau dibalik,
// request yang sedang jalan bisa tiba-tiba kehilangan koneksi DB di tengah transaksi.
function shutdown(signal) {
  logger.info(`${signal} diterima, mematikan server dengan rapi...`);

  server.close(async () => {
    logger.info("HTTP server ditutup, tidak menerima koneksi baru");
    try {
      await pool.end();
      logger.info("Pool pg ditutup");
    } catch (err) {
      logger.error("Gagal menutup pool pg:", err.message);
    }
    try {
      await redis.quit();
      logger.info("Koneksi Redis ditutup");
    } catch (err) {
      logger.error("Gagal menutup Redis:", err.message);
    }
    process.exit(0);
  });

  // Jaring pengaman: kalau graceful shutdown macet (misal ada request yang menggantung
  // selamanya), paksa keluar setelah 10 detik daripada proses nyangkut tak terbatas.
  setTimeout(() => {
    logger.error("Graceful shutdown timeout, paksa keluar");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
