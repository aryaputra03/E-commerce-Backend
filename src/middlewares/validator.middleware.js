const { validationResult } = require("express-validator");
const { error } = require("../utils/response");

// Dipasang SETELAH array rule validasi (body(...), dst) di route.
// Kalau ada rule yang gagal, langsung return 400 — controller tidak akan pernah jalan.
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return error(res, 400, "Validasi input gagal", formattedErrors);
  }

  next();
}

module.exports = handleValidationErrors;
