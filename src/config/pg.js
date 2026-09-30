const { Pool } = require("pg");
require("dotenv").config();

// Pool koneksi langsung ke PostgreSQL, dipakai khusus untuk raw query
// yang butuh transaction eksplisit (BEGIN/COMMIT/ROLLBACK) dan row locking (FOR UPDATE).
// Fase 1 belum dipakai — baru aktif dipakai di checkout.controller.js (Fase 4).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase butuh SSL
});

pool.on("error", (err) => {
  console.error("Unexpected error pada idle client pg Pool", err);
  process.exit(-1);
});

module.exports = pool;
