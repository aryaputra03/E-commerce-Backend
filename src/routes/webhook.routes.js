const express = require("express");
const router = express.Router();

const webhookController = require("../controllers/webhook.controller");

router.post("/midtrans", webhookController.handleMidtransWebhook);

module.exports = router;
