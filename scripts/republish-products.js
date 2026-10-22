// Menerbitkan ulang SEMUA produk sebagai event product.created lewat outbox.
// Dipakai untuk: mengisi indeks dari produk lama (sebelum trigger 006 ada), dan membangun ulang
// indeks setelah dihapus. Catatan: dokumen dengan versi SAMA diabaikan Elasticsearch, jadi untuk
// bangun ulang penuh HAPUS indeks dulu (lihat panduan pengujian).
require("dotenv").config();
const pool = require("../src/config/pg");

async function main() {
  const { rowCount } = await pool.query(`
    INSERT INTO outbox_events (topic, key, payload)
    SELECT 'product.events', p.id::text, jsonb_build_object(
      'type', 'product.created',
      'updatedAt', p.updated_at,
      'product', jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description,
        'price', p.price, 'stock', p.stock, 'categoryId', p.category_id,
        'categoryName', c.name, 'imageUrl', p.image_url, 'isActive', p.is_active))
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`);
  console.log(
    `${rowCount} event product.created masuk outbox. outbox-relay akan mengirimnya ke Kafka.`,
  );
}

main()
  .catch((err) => {
    console.error("republish gagal:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
