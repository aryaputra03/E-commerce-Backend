const { randomUUID } = require("crypto");

// Memberi tiap request ID unik yang bisa ditelusuri lewat log. Mulai berguna sekarang untuk
// debugging, dan nanti di Fase 9-12 ID yang sama ini akan ikut dibawa ke header pesan Kafka —
// jadi 1 request bisa ditelusuri dari HTTP log sampai ke log worker yang memprosesnya.
function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  // Terima request id dari luar HANYA kalau formatnya masuk akal, supaya client sembarangan
  // tidak bisa menyuntik nilai aneh-aneh ke log kita.
  req.requestId =
    typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

module.exports = requestId;
