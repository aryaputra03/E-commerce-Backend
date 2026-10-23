require("dotenv").config();
const { randomUUID } = require("crypto");
const pool = require("../src/config/pg");
const { transitionOrder } = require("../src/services/orderStatus.service");

const EXPIRY_MINUTES = (Number(process.env.ORDER_EXPIRY_MINUTES) || 60) + 5;
const POLL_INTERVAL_MS = 60000;

async function expireOnce() {
  const { rows } = await pool.query(
    `SELECT id FROM orders WHERE status = 'pending'
     AND created_at < now() - make_interval(mins => $1)
     ORDER BY created_at LIMIT 50`,
    [EXPIRY_MINUTES],
  );

  for (const { id } of rows) {
    const requestId = `expiry-${randomUUID()}`; // ditangkap di sini supaya bisa dipakai di log juga
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await transitionOrder(client, id, "cancelled", {
        source: "expiry",
        onlyFrom: "pending",
        requestId,
      });
      await client.query("COMMIT");

      if (result.ok && result.changed) {
        console.log(
          `${new Date().toISOString()} [${requestId}] order.events order.cancelled ${id} -> expired`,
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
