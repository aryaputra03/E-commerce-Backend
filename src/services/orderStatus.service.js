// Tabel transisi legal: key = status asal, value = daftar status tujuan yang diizinkan.
// Status yang tidak ada di sini (completed, cancelled, failed) adalah status AKHIR — tidak bisa diubah lagi.
const TRANSITIONS = {
  pending: ["paid", "failed", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
  failed: [],
};

const RELEASE_STOCK_ON = new Set(["cancelled", "failed"]);

// WAJIB dipanggil DI DALAM transaksi pg yang sudah BEGIN (client dari pool.connect()).
// ctx.onlyFrom: kalau diisi, transisi hanya dieksekusi kalau status order SAAT INI persis
// sama dengan ini — dipakai worker expiry supaya tidak membatalkan order yang baru saja dibayar.
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
    // Status sudah berubah duluan (misal keburu 'paid') sebelum baris ini dieksekusi -> diamkan, bukan error.
    return { ok: true, changed: false, from, to: from };
  }

  if (from === toStatus) {
    // IDEMPOTENCY: status tujuan sama persis dengan status sekarang -> tidak ada yang perlu diubah.
    return { ok: true, changed: false, from, to: toStatus };
  }

  if (!TRANSITIONS[from].includes(toStatus)) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", from, to: toStatus };
  }

  if (RELEASE_STOCK_ON.has(toStatus)) {
    // Kunci produk BERURUTAN (sama persis seperti checkout.controller.js) — supaya kalau transaksi
    // ini kebetulan jalan bersamaan dengan transaksi checkout lain yang mengunci produk yang sama,
    // keduanya tidak saling deadlock karena urutan lock-nya konsisten.
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

  // CATATAN untuk Fase 10 nanti: di titik inilah akan ditambahkan pemanggilan
  // enqueueOrderEvent(client, orderId, `order.${toStatus}`, ctx.requestId) untuk menulis
  // baris event ke outbox table. Belum dikerjakan sekarang — Kafka belum ada.

  return { ok: true, changed: true, from, to: toStatus };
}

module.exports = { transitionOrder, TRANSITIONS };
