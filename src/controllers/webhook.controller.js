const crypto = require("crypto");
const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

// Konversi status Midtrans -> status internal kita (pending | paid | failed | cancelled)
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

// POST /api/webhook/midtrans
// TIDAK pakai authMiddleware — pemanggilnya server Midtrans, bukan user login.
// Keamanan endpoint ini 100% bergantung pada verifikasi signature_key di bawah.
async function handleMidtransWebhook(req, res, next) {
  try {
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

    // Rumus signature resmi Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey)
    const expectedSignature = crypto
      .createHash("sha512")
      .update(
        `${midtransOrderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`,
      )
      .digest("hex");

    if (expectedSignature !== signatureKey) {
      // Signature tidak cocok -> TOLAK MENTAH-MENTAH, jangan sentuh data apa pun.
      // Ini mencegah orang iseng kirim POST palsu ke endpoint ini untuk mengubah status order orang lain.
      return error(res, 401, "Signature tidak valid");
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("id, order_id, status")
      .eq("midtrans_order_id", midtransOrderId)
      .maybeSingle();

    if (!payment) {
      // Order tidak dikenal di sistem kita. Tetap balas 200 (bukan 404) supaya Midtrans
      // tidak terus menerus retry mengirim webhook yang sama berkali-kali.
      return success(res, 200, "Order tidak ditemukan, diabaikan");
    }

    const newStatus = mapMidtransStatus(transactionStatus, fraudStatus);

    // IDEMPOTENCY: kalau status yang diminta SAMA PERSIS dengan yang sudah tersimpan,
    // jangan proses ulang. Midtrans (dan payment gateway manapun di real-world) memang
    // bisa mengirim webhook yang sama lebih dari sekali — sistem kita harus tahan terhadap itu.
    if (payment.status === newStatus) {
      return success(
        res,
        200,
        "Status sudah sesuai, tidak ada perubahan (idempotent)",
      );
    }

    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({ status: newStatus, raw_payload: req.body })
      .eq("id", payment.id);
    if (updatePaymentError) throw updatePaymentError;

    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", payment.order_id);
    if (updateOrderError) throw updateOrderError;

    return success(res, 200, "Status order berhasil diperbarui", {
      order_id: payment.order_id,
      status: newStatus,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { handleMidtransWebhook };
