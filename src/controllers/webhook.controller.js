const crypto = require("crypto");
const pool = require("../config/pg");
const { transitionOrder } = require("../services/orderStatus.service");
const { success, error } = require("../utils/response");

function mapMidtransStatus(transactionStatus, fraudStatus) {
  if (transactionStatus === "capture") {
    return fraudStatus === "accept" ? "paid" : "pending";
  }
  if (transactionStatus === "settlement") return "paid";
  if (transactionStatus === "pending") return "pending";
  if (transactionStatus === "deny") return "failed";
  if (transactionStatus === "cancel" || transactionStatus === "expire")
    return "cancelled";
  return "pending";
}

async function handleMidtransWebhook(req, res, next) {
  const {
    order_id: midtransOrderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: signatureKey,
    transaction_status: transactionStatus,
    fraud_status: fraudStatus,
  } = req.body;

  if (!midtransOrderId || !statusCode || !grossAmount || !signatureKey) {
    return error(res, 400, "Payload webhook tidak lengkap");
  }

  const expectedSignature = crypto
    .createHash("sha512")
    .update(
      `${midtransOrderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`,
    )
    .digest("hex");

  if (expectedSignature !== signatureKey) {
    return error(res, 401, "Signature tidak valid");
  }

  const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pay = await client.query(
      "SELECT id, order_id FROM payments WHERE midtrans_order_id = $1",
      [midtransOrderId],
    );

    if (pay.rowCount === 0) {
      await client.query("ROLLBACK");
      return success(res, 200, "Order tidak ditemukan, diabaikan");
    }

    const result = await transitionOrder(
      client,
      pay.rows[0].order_id,
      newStatus,
      {
        source: "webhook",
        requestId: req.requestId,
      },
    );

    // DIUBAH dari Fase 5: idempotency sekarang datang dari transitionOrder (berbasis status
    // ORDER), bukan dicek manual dari status payment. payments hanya ikut diupdate kalau
    // transisi order BENAR-BENAR terjadi.
    if (result.ok && result.changed) {
      await client.query(
        "UPDATE payments SET status = $2, raw_payload = $3 WHERE id = $1",
        [pay.rows[0].id, newStatus, JSON.stringify(req.body)],
      );
    }

    await client.query("COMMIT");

    if (!result.ok) {
      // Transisi ilegal (contoh nyata: webhook 'pending' datang TERLAMBAT setelah order
      // sudah 'paid') -> order TIDAK diubah, tapi tetap balas 200 supaya Midtrans tidak
      // mengira webhook gagal lalu mengirim ulang terus-menerus.
      console.warn(
        `Webhook ${transactionStatus} diabaikan: ${result.reason} (order ${pay.rows[0].order_id})`,
      );
      return success(res, 200, "Transisi diabaikan");
    }

    return success(
      res,
      200,
      result.changed
        ? "Status order berhasil diperbarui"
        : "Status sudah sesuai, tidak ada perubahan (idempotent)",
      { order_id: pay.rows[0].order_id, status: result.to },
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

module.exports = { handleMidtransWebhook };
