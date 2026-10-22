// Dipanggil DI DALAM transaksi pg yang sedang berjalan (client sudah BEGIN).
// Karena satu transaksi dengan perubahan datanya, baris outbox ini TIDAK MUNGKIN hilang
// (kalau transaksi commit, baris ini pasti ikut tersimpan) dan TIDAK MUNGKIN terbit untuk
// perubahan yang di-ROLLBACK (baris outbox-nya ikut batal juga).
async function enqueueOrderEvent(client, orderId, type, requestId) {
  const { rows } = await client.query(
    `SELECT o.id, o.user_id, o.status, o.total_amount,
       COALESCE(json_agg(json_build_object('productId', oi.product_id,
         'quantity', oi.quantity, 'price', oi.price_at_time))
         FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = $1 GROUP BY o.id`,
    [orderId],
  );

  const o = rows[0];
  const payload = {
    type,
    orderId: o.id,
    userId: o.user_id,
    status: o.status,
    totalAmount: Number(o.total_amount),
    items: o.items,
    occurredAt: new Date().toISOString(),
  };

  await client.query(
    `INSERT INTO outbox_events (topic, key, payload, headers) VALUES ('order.events', $1, $2, $3)`,
    [
      o.id,
      JSON.stringify(payload),
      JSON.stringify({ "x-request-id": requestId || "" }),
    ],
  );
}

module.exports = { enqueueOrderEvent };
