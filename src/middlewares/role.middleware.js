const { error } = require("../utils/response");

// Higher-order function: dipanggil dengan role yang diizinkan.
// Contoh: router.post('/products', authMiddleware, requireRole('admin'), controller.create)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 401, "Belum login");
    }
    if (!allowedRoles.includes(req.user.role)) {
      return error(res, 403, "Kamu tidak punya akses ke resource ini");
    }
    next();
  };
}

module.exports = requireRole;
