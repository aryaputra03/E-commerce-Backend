const express = require("express");
const router = express.Router();
const { param } = require("express-validator");

const orderController = require("../controllers/order.controller");
const handleValidationErrors = require("../middlewares/validator.middleware");

router.get("/", orderController.getOrders);
router.get(
  "/:id",
  param("id").isUUID().withMessage("id order tidak valid"),
  handleValidationErrors,
  orderController.getOrderById,
);

module.exports = router;
