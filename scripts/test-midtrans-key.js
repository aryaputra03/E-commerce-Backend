require("dotenv").config();
const midtransClient = require("midtrans-client");

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

(async () => {
  try {
    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: `test-key-${Date.now()}`,
        gross_amount: 10000,
      },
      customer_details: { first_name: "Test", email: "test@mail.com" },
    });
    console.log("✅ Server Key VALID. Redirect URL:", transaction.redirect_url);
  } catch (err) {
    console.error("❌ Server Key BERMASALAH:", err.message);
  }
})();
