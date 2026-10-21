-- PENTING: aplikasi kita mengakses database lewat 2 jalur yang SAMA-SAMA melewati RLS:
-- 1. Supabase client pakai SERVICE_ROLE_KEY (selalu bypass RLS)
-- 2. pg Pool connect sebagai role "postgres" lewat connection pooler (juga bypass RLS)
-- Jadi mengaktifkan RLS di sini TIDAK akan merusak endpoint yang sudah jalan. Yang berubah:
-- role "anon" dan "authenticated" bawaan Supabase (dipakai kalau suatu saat ada akses
-- langsung dari frontend tanpa lewat backend kita) otomatis TIDAK BISA baca/tulis apa pun,
-- karena kita sengaja tidak membuat satu pun POLICY di bawah ini.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;