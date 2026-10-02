const redis = require("../config/redis");
const { error } = require("../utils/response");

const WINDOW_SECONDS = Number(process.env.CHECKOUT_RATE_LIMIT_WINDOW_SEC) || 60;
const MAX_REQUESTS = Number(process.env.CHECKOUT_RATE_LIMIT_MAX) || 5;

// Sliding-window sederhana pakai Redis INCR + EXPIRE, per user_id.
// Kenapa per user_id (bukan per IP)? Karena endpoint ini sudah di belakang authMiddleware,
// jadi kita punya identitas pasti — lebih akurat daripada per IP yang bisa dipakai banyak user (NAT/kampus/kantor).
async function rateLimitCheckout(req, res, next) {
  try {
    const userId = req.user.id;
    const key = `rate:checkout:${userId}`;

    const currentCount = await redis.incr(key);

    if (currentCount === 1) {
      // Baru pertama kali kena increment dalam window ini -> pasang TTL
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (currentCount > MAX_REQUESTS) {
      const ttl = await redis.ttl(key);
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
