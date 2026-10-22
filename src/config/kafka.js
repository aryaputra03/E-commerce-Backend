const { Kafka } = require("kafkajs");
require("dotenv").config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "ecommerce-backend",
  brokers: (process.env.KAFKA_BROKERS || "localhost:29092").split(","),
  // retry bawaan kafkajs: kalau broker belum siap / lagi down, coba lagi otomatis
  // dengan jeda yang makin lama (exponential backoff) sampai 8 kali sebelum menyerah.
  retry: { initialRetryTime: 300, retries: 8 },
});

module.exports = kafka;
