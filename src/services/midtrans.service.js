const midtransClient = require("midtrans-client");
require("dotenv").config();

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Generate Snap token + redirect_url (halaman pembayaran) untuk 1 order yang baru dibuat.
// order_id yang dikirim ke Midtrans = order.id kita sendiri — supaya gampang dicocokkan balik
// tanpa perlu tabel mapping terpisah saat webhook datang.
async function createPaymentTransaction(order, items, customer) {
  const parameter = {
    transaction_details: {
      order_id: order.id,
      gross_amount: Math.round(Number(order.total_amount)),
    },
    customer_details: {
      first_name: customer.name,
      email: customer.email,
    },
    item_details: items.map((item) => ({
      id: item.product_id,
      price: Math.round(item.price),
      quantity: item.quantity,
      name: item.name,
    })),
  };

  // transaction berisi { token, redirect_url }
  const transaction = await snap.createTransaction(parameter);
  return transaction;
}

module.exports = { createPaymentTransaction };
