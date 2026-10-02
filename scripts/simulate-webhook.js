// Cara pakai: node scripts/simulate-webhook.js <order_id> <gross_amount> <transaction_status>
// Contoh: node scripts/simulate-webhook.js 6bee4966-3ed0-471b-ab6e-e30ed1a5d134 25000 settlement
//
// transaction_status yang valid untuk ditest: settlement, pending, deny, cancel, expire

require("dotenv").config();
const crypto = require("crypto");

const [, , orderId, grossAmount, transactionStatus] = process.argv;

if (!orderId || !grossAmount || !transactionStatus) {
  console.error(
    "Usage: node scripts/simulate-webhook.js <order_id> <gross_amount> <transaction_status>",
  );
  process.exit(1);
}

const statusCode = "200";
const formattedAmount = `${grossAmount}.00`; // Midtrans selalu kirim gross_amount dengan 2 desimal

const signatureKey = crypto
  .createHash("sha512")
  .update(
    `${orderId}${statusCode}${formattedAmount}${process.env.MIDTRANS_SERVER_KEY}`,
  )
  .digest("hex");

const payload = {
  order_id: orderId,
  status_code: statusCode,
  gross_amount: formattedAmount,
  signature_key: signatureKey,
  transaction_status: transactionStatus,
  fraud_status: "accept",
};

(async () => {
  const res = await fetch("http://localhost:5000/api/webhook/midtrans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  console.log(`HTTP ${res.status}`, body);
})();
