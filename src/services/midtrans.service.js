const midtransClient = require("midtrans-client");
require("dotenv").config();

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const EXPIRY_MINUTES = Number(process.env.ORDER_EXPIRY_MINUTES) || 60;

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
    // BARU: batas waktu pembayaran di sisi Midtrans — nilainya dari ORDER_EXPIRY_MINUTES
    // yang sama dipakai worker order-expiry, supaya keduanya sinkron.
    expiry: {
      unit: "minutes",
      duration: EXPIRY_MINUTES,
    },
  };

  const transaction = await snap.createTransaction(parameter);
  return transaction;
}

module.exports = { createPaymentTransaction };
