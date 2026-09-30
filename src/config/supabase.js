const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset di .env",
  );
}

// Client ini dipakai untuk query CRUD biasa: auth, produk, cart, order history
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false, // backend tidak butuh session browser
  },
});

module.exports = supabase;
