-- ============================================================================
-- Fase 11 — Trigger outbox untuk event produk
-- ============================================================================

-- (A) Perbaikan kecil pada set_updated_at (dari 002).
-- now() di PostgreSQL = waktu MULAI transaksi, bukan waktu baris diubah. Dua checkout yang
-- berebut produk yang sama bisa menghasilkan updated_at yang urutannya TERBALIK dari urutan
-- commit-nya. Karena updated_at dipakai sebagai "versi eksternal" di Elasticsearch, event
-- yang lebih baru bisa dianggap usang dan stok di search index jadi salah.
-- clock_timestamp() = jam dinding saat trigger berjalan (setelah row lock didapat), dan
-- GREATEST(...) menjamin versi selalu naik minimal 1 ms dari nilai sebelumnya.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  RETURN NEW;
END $$;

-- (B) Trigger yang menulis baris outbox untuk setiap INSERT / UPDATE / DELETE pada products.
CREATE OR REPLACE FUNCTION enqueue_product_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  t text;
  v_cat text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD; t := 'product.deleted';
  ELSIF TG_OP = 'INSERT' THEN
    r := NEW; t := 'product.created';
  ELSE
    r := NEW; t := 'product.updated';
  END IF;

  SELECT name INTO v_cat FROM categories WHERE id = r.category_id;

  INSERT INTO outbox_events (topic, key, payload)
  VALUES (
    'product.events',
    r.id::text,
    jsonb_build_object(
      'type', t,
      'updatedAt', CASE WHEN TG_OP = 'DELETE' THEN now() ELSE r.updated_at END,
      'product', jsonb_build_object(
        'id', r.id, 'name', r.name, 'description', r.description,
        'price', r.price, 'stock', r.stock, 'categoryId', r.category_id,
        'categoryName', v_cat, 'imageUrl', r.image_url, 'isActive', r.is_active
      )
    )
  );

  RETURN NULL; -- trigger AFTER: nilai kembalian diabaikan
END $$;

DROP TRIGGER IF EXISTS trg_products_outbox ON products;
CREATE TRIGGER trg_products_outbox
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION enqueue_product_event();