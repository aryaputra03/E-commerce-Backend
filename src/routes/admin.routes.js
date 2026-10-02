const express = require("express");
const router = express.Router();
const { param, body, query } = require("express-validator");

const adminController = require("../controllers/admin.controller");
const handleValidationErrors = require("../middlewares/validator.middleware");

const { VALID_STATUSES } = adminController;

// authMiddleware + requireRole('admin') dipasang di app.js saat mounting router ini —
// SEMUA endpoint di sini tanpa kecuali wajib admin, jadi lebih bersih dipasang sekali di mount level.

router.get(
  "/orders",
  query("status")
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage("status tidak valid"),
  handleValidationErrors,
  adminController.getAllOrders,
);

router.put(
  "/orders/:id/status",
  [
    param("id").isUUID().withMessage("id order tidak valid"),
    body("status")
      .isIn(VALID_STATUSES)
      .withMessage(
        `status harus salah satu dari: ${VALID_STATUSES.join(", ")}`,
      ),
  ],
  handleValidationErrors,
  adminController.updateOrderStatus,
);

router.get(
  "/reports/summary",
  query("period")
    .optional()
    .isIn(["daily", "monthly"])
    .withMessage("period harus daily atau monthly"),
  handleValidationErrors,
  adminController.getSalesSummary,
);

module.exports = router;
