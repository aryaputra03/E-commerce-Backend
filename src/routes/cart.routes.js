const express = require("express");
const router = express.Router();
const { body, param } = require("express-validator");

const cartController = require("../controllers/cart.controller");
const handleValidationErrors = require("../middlewares/validator.middleware");

// authMiddleware TIDAK dipasang per-route di sini, tapi di app.js saat mounting router ini.
// Alasan: SEMUA endpoint cart butuh login tanpa kecuali, jadi lebih bersih dipasang sekali di level mount.

router.get("/", cartController.getCart);

router.post(
  "/items",
  [
    body("product_id").isUUID().withMessage("product_id harus UUID valid"),
    body("quantity").isInt({ min: 1 }).withMessage("quantity minimal 1"),
  ],
  handleValidationErrors,
  cartController.addItem,
);

router.put(
  "/items/:productId",
  [
    param("productId").isUUID().withMessage("productId tidak valid"),
    body("quantity").isInt({ min: 1 }).withMessage("quantity minimal 1"),
  ],
  handleValidationErrors,
  cartController.updateItem,
);

router.delete(
  "/items/:productId",
  param("productId").isUUID().withMessage("productId tidak valid"),
  handleValidationErrors,
  cartController.removeItem,
);

router.delete("/", cartController.clearCart);

module.exports = router;
