const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "postgres",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }, // Supabase mewajibkan koneksi SSL
});

pool.on("error", (err) => {
  console.error("Unexpected error pada idle client pg Pool", err);
  process.exit(-1);
});

module.exports = pool;
