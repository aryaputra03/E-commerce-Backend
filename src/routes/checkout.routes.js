const express = require("express");
const router = express.Router();

const checkoutController = require("../controllers/checkout.controller");
const rateLimitCheckout = require("../middlewares/rateLimit.checkout");

// authMiddleware dipasang di app.js saat mounting (sama polanya seperti cart.routes.js)
router.post("/", rateLimitCheckout, checkoutController.checkout);

module.exports = router;
