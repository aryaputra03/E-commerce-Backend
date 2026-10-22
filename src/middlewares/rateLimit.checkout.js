const redis = require("../config/redis");
const { error } = require("../utils/response");

const WINDOW_SECONDS = Number(process.env.CHECKOUT_RATE_LIMIT_WINDOW_SEC) || 60;
const MAX_REQUESTS = Number(process.env.CHECKOUT_RATE_LIMIT_MAX) || 5;

// Fixed-window rate limit per user_id. (Catatan: ini FIXED window, bukan sliding window —
// window-nya reset total di detik ke-60, bukan "60 detik terakhir dari sekarang" yang bergerak.
// Untuk kebutuhan proteksi checkout dari spam, fixed window sudah cukup dan jauh lebih sederhana.)
async function rateLimitCheckout(req, res, next) {
  try {
    const userId = req.user.id;
    const key = `rate:checkout:${userId}`;

    // INCR dan TTL dibaca dalam SATU pipeline (MULTI) -> atomik, tidak ada celah waktu
    // di antara keduanya seperti versi sebelumnya.
    const results = await redis.multi().incr(key).ttl(key).exec();
    const currentCount = results[0][1];
    let ttl = results[1][1];

    if (ttl === -1) {
      // Key ada tapi TANPA TTL — ini kondisi yang dulu bisa bikin user terblokir permanen.
      // Self-heal: pasang TTL sekarang juga, baik karena ini increment pertama kalinya,
      // maupun karena key ini warisan proses lama yang sempat berhenti di tengah jalan.
      await redis.expire(key, WINDOW_SECONDS);
      ttl = WINDOW_SECONDS;
    }

    if (currentCount > MAX_REQUESTS) {
      return error(
        res,
        429,
        `Terlalu banyak percobaan checkout, coba lagi dalam ${ttl} detik`,
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = rateLimitCheckout;
