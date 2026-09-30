const logger = require("../utils/logger");
const { error } = require("../utils/response");

// Middleware error harus punya 4 parameter (err, req, res, next) —
// ini yang membuat Express tahu ini adalah error handler, bukan middleware biasa.
// eslint-disable-next-line no-unused-vars
function errorHandlerMiddleware(err, req, res, next) {
  logger.error(err.stack || err.message || err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Terjadi kesalahan pada server";

  return error(res, statusCode, message);
}

module.exports = errorHandlerMiddleware;
