const pool = require("../config/pg");
const supabase = require("../config/supabase");
const { createPaymentTransaction } = require("../services/midtrans.service");
const { success, error } = require("../utils/response");

// POST /api/checkout
async function checkout(req, res, next) {
  const userId = req.user.id;
  let client;

  try {
    const { data: cartItems, error: cartError } = await supabase
      .from("cart_items")
      .select("product_id, quantity")
      .eq("user_id", userId);

    if (cartError) throw cartError;

    if (!cartItems || cartItems.length === 0) {
      return error(res, 400, "Keranjang kosong, tidak bisa checkout");
    }

    const sortedItems = [...cartItems].sort((a, b) =>
      a.product_id > b.product_id ? 1 : -1,
    );

    client = await pool.connect();
    await client.query("BEGIN");

    const lockedItems = [];

    for (const item of sortedItems) {
      // Sekarang ikut SELECT "name" — dipakai nanti untuk item_details Midtrans
      const result = await client.query(
        "SELECT id, name, stock, price FROM products WHERE id = $1 FOR UPDATE",
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
        name: product.name,
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

    await supabase.from("cart_items").delete().eq("user_id", userId);

    // --- Mulai bagian baru Fase 5: generate payment link Midtrans ---
    // Ini SENGAJA di LUAR transaction pg di atas — order & stock sudah final (committed),
    // tidak boleh di-ROLLBACK lagi hanya karena Midtrans lagi down. Kalau gagal generate
    // payment link, order tetap ada (status 'pending'), cuma payment-nya null — bisa di-retry nanti.
    let paymentInfo = null;
    try {
      const { data: customer } = await supabase
        .from("users")
        .select("name, email")
        .eq("id", userId)
        .single();

      const transaction = await createPaymentTransaction(
        order,
        lockedItems,
        customer,
      );

      const { data: payment, error: paymentInsertError } = await supabase
        .from("payments")
        .insert({
          order_id: order.id,
          midtrans_order_id: order.id,
          status: "pending",
          payment_url: transaction.redirect_url,
          raw_payload: transaction,
        })
        .select()
        .single();

      if (paymentInsertError) throw paymentInsertError;

      paymentInfo = {
        redirect_url: payment.payment_url,
        token: transaction.token,
      };
    } catch (paymentErr) {
      console.error(
        "Gagal generate payment link Midtrans:",
        paymentErr.message,
      );
      // Tidak melempar error ke next() di sini — order tetap dianggap berhasil dibuat.
      // paymentInfo tetap null, frontend bisa kasih tombol "coba generate payment lagi".
    }
    // --- Selesai bagian baru ---

    return success(res, 201, "Checkout berhasil, order dibuat", {
      order,
      items: lockedItems,
      payment: paymentInfo,
    });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = { checkout };
