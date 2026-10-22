const { enqueueOrderEvent } = require("./outbox.service"); // baru

const TRANSITIONS = {
  pending: ["paid", "failed", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
  failed: [],
};

const RELEASE_STOCK_ON = new Set(["cancelled", "failed"]);

async function transitionOrder(client, orderId, toStatus, ctx = {}) {
  const { rows } = await client.query(
    "SELECT id, user_id, status FROM orders WHERE id = $1 FOR UPDATE",
    [orderId],
  );

  if (!rows.length) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const from = rows[0].status;

  if (ctx.onlyFrom && from !== ctx.onlyFrom) {
    return { ok: true, changed: false, from, to: from };
  }

  if (from === toStatus) {
    // PENTING: karena baris ini return SEBELUM enqueueOrderEvent dipanggil di bawah,
    // webhook/admin yang mengirim status yang SAMA PERSIS dengan status sekarang tidak
    // akan pernah menghasilkan event baru. Idempotency di level order ini otomatis
    // mencegah event duplikat terbit — bukan cuma dicegah di sisi consumer nanti.
    return { ok: true, changed: false, from, to: toStatus };
  }

  if (!TRANSITIONS[from].includes(toStatus)) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", from, to: toStatus };
  }

  if (RELEASE_STOCK_ON.has(toStatus)) {
    await client.query(
      `SELECT id FROM products
       WHERE id IN (SELECT product_id FROM order_items WHERE order_id = $1)
       ORDER BY id FOR UPDATE`,
      [orderId],
    );
    await client.query(
      `UPDATE products p SET stock = p.stock + oi.qty
       FROM (SELECT product_id, SUM(quantity) AS qty FROM order_items
             WHERE order_id = $1 GROUP BY product_id) oi
       WHERE p.id = oi.product_id`,
      [orderId],
    );
  }

  await client.query("UPDATE orders SET status = $2 WHERE id = $1", [
    orderId,
    toStatus,
  ]);

  // BARU (Fase 10): tulis event ke outbox, DALAM transaksi pg yang sama.
  await enqueueOrderEvent(client, orderId, `order.${toStatus}`, ctx.requestId);

  return { ok: true, changed: true, from, to: toStatus };
}

module.exports = { transitionOrder, TRANSITIONS };
