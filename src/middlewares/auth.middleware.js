const { verifyAccessToken } = require("../services/token.service");
const { error } = require("../utils/response");

// Middleware ini melindungi endpoint yang butuh login.
// Cara pakai: pasang di route, contoh: router.get('/me', authMiddleware, controller.me)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization; // format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return error(res, 401, "Token tidak ditemukan");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token); // { id, role, iat, exp }
    req.user = decoded; // bisa diakses di controller lewat req.user
    next();
  } catch (err) {
    return error(res, 401, "Token tidak valid atau sudah kedaluwarsa");
  }
}

module.exports = authMiddleware;
