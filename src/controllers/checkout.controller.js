const pool = require("../config/pg");
const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

// POST /api/checkout
async function checkout(req, res, next) {
  const userId = req.user.id;
  let client; // dideklarasikan di luar try supaya bisa di-release di catch juga

  try {
    // 1. Ambil isi cart dulu lewat Supabase client biasa
    const { data: cartItems, error: cartError } = await supabase
      .from("cart_items")
      .select("product_id, quantity")
      .eq("user_id", userId);

    if (cartError) throw cartError;

    if (!cartItems || cartItems.length === 0) {
      return error(res, 400, "Keranjang kosong, tidak bisa checkout");
    }

    // 2. Urutkan berdasarkan product_id untuk mencegah deadlock
    const sortedItems = [...cartItems].sort((a, b) =>
      a.product_id > b.product_id ? 1 : -1,
    );

    // 3. BARU di sini kita ambil koneksi dari pool — kalau gagal, langsung ketangkap catch di bawah
    client = await pool.connect();
    await client.query("BEGIN");

    const lockedItems = [];

    for (const item of sortedItems) {
      const result = await client.query(
        "SELECT id, stock, price FROM products WHERE id = $1 FOR UPDATE",
        [item.product_id],
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return error(
          res,
          404,
          `Produk dengan id ${item.product_id} tidak ditemukan`,
        );
      }

      const product = result.rows[0];

      if (product.stock < item.quantity) {
        await client.query("ROLLBACK");
        return error(
          res,
          409,
          `Stok tidak mencukupi untuk salah satu produk (tersisa ${product.stock}, diminta ${item.quantity})`,
        );
      }

      lockedItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price: Number(product.price),
      });
    }

    for (const item of lockedItems) {
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.product_id],
      );
    }

    const totalAmount = lockedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const orderResult = await client.query(
      `insert into orders (user_id, status, total_amount)
       values ($1, 'pending', $2)
       returning id, status, total_amount, created_at`,
      [userId, totalAmount],
    );
    const order = orderResult.rows[0];

    for (const item of lockedItems) {
      await client.query(
        `insert into order_items (order_id, product_id, quantity, price_at_time)
         values ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price],
      );
    }

    await client.query("COMMIT");

    // Kosongkan cart SETELAH commit sukses
    await supabase.from("cart_items").delete().eq("user_id", userId);

    return success(res, 201, "Checkout berhasil, order dibuat", {
      order,
      items: lockedItems,
    });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    next(err);
  } finally {
    // finally memastikan koneksi SELALU dilepas ke pool, apa pun yang terjadi di atas —
    // baik sukses, early return (400/404/409), maupun error tak terduga.
    if (client) {
      client.release();
    }
  }
}

module.exports = { checkout };
