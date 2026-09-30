const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

// Buat access token — umur pendek, dipakai di header Authorization tiap request
function generateAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

// Buat refresh token — umur panjang, dipakai cuma untuk minta access token baru
function generateRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET); // throw error kalau invalid/expired
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

// Refresh token yang disimpan di DB bukan token asli, tapi hash-nya (SHA-256).
// Ini bukan bcrypt karena refresh token sudah random & panjang (bukan password manusia),
// jadi hash cepat sudah cukup aman dan lebih murah secara performa.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Hitung tanggal expired refresh token dalam bentuk Date, dipakai untuk kolom expires_at
function getRefreshTokenExpiryDate() {
  const decoded = jwt.decode(generateRefreshToken({ tmp: true }));
  return new Date(decoded.exp * 1000);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiryDate,
};
