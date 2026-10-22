const { Client } = require("@elastic/elasticsearch");
require("dotenv").config();

// Versi mayor client (8.x) harus sama dengan versi server Elasticsearch (8.x).
const es = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
  // Kalau ES mati/lambat, request search harus cepat gagal (lalu dibalas 503), bukan menggantung
  // sampai client HTTP si pemanggil timeout.
  requestTimeout: 5000,
  maxRetries: 1,
});

module.exports = es;