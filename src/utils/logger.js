// Logger sederhana — cukup untuk kebutuhan sekarang.
// Nanti bisa diganti pakai winston/pino kalau butuh log ke file/service eksternal.
const timestamp = () => new Date().toISOString();

const logger = {
  info: (...args) => console.log(`[INFO] ${timestamp()} -`, ...args),
  warn: (...args) => console.warn(`[WARN] ${timestamp()} -`, ...args),
  error: (...args) => console.error(`[ERROR] ${timestamp()} -`, ...args),
};

module.exports = logger;
