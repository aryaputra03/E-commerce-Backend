# E-commerce Backend

Backend toko online dengan fokus pada transaksi aman dari race condition saat checkout,
integrasi payment gateway sungguhan (Midtrans Sandbox), arsitektur event-driven lewat
Kafka (transactional outbox), dan pencarian produk berbasis Elasticsearch.

## Tech Stack

- Node.js + Express
- Supabase (PostgreSQL) — CRUD umum lewat Supabase client
- `pg` (node-postgres) — raw query + transaction untuk checkout & transisi status order
- Redis (`ioredis`) — rate limiting endpoint checkout
- Midtrans Snap — payment gateway (sandbox)
- Apache Kafka (KRaft, via `apache/kafka` Docker image) — event bus (`kafkajs`)
- Elasticsearch — read model pencarian produk (`@elastic/elasticsearch`)
- JWT (access + refresh token dengan rotation)

## Setup

1. Install dependency:
   ```powershell
   npm install
   ```
2. Copy `.env.example` menjadi `.env`, isi semua kredensial (lihat tabel environment variable)
3. Jalankan seluruh file di `sql/` **berurutan** (001 sampai 006) di Supabase SQL Editor
4. Jalankan Redis (standalone, terpisah dari docker-compose):
   ```powershell
   docker run -d --name redis-ecommerce -p 6379:6379 redis
   ```
5. Jalankan infrastruktur Kafka + Elasticsearch:
   ```powershell
   docker compose up -d
   docker compose ps   # tunggu semua "healthy"
   ```
6. Isi index Elasticsearch dari produk yang sudah ada (sekali saja, atau tiap rebuild index):
   ```powershell
   npm run republish
   ```
7. Jalankan server + semua worker (2 terminal):
   ```powershell
   npm run dev
   npm run workers
   ```

## Environment Variables

| Variable                                                    | Keterangan                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                                                      | Port server, default `5000`                                                                        |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                 | Dari Supabase Project Settings → API                                                               |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`    | Koneksi pg Pool langsung via Supabase Transaction Pooler                                           |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                   | String random panjang (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`           | Default `15m` dan `7d`                                                                             |
| `REDIS_URL`                                                 | Default `redis://127.0.0.1:6379`                                                                   |
| `CHECKOUT_RATE_LIMIT_MAX`, `CHECKOUT_RATE_LIMIT_WINDOW_SEC` | Rate limit checkout per user, default 5x/60 detik                                                  |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`                | Dari **dashboard.sandbox.midtrans.com** (bukan production!)                                        |
| `MIDTRANS_IS_PRODUCTION`                                    | `false` untuk development                                                                          |
| `ALLOWED_ORIGINS`                                           | Daftar origin frontend yang diizinkan CORS, pisah koma                                             |
| `ORDER_EXPIRY_MINUTES`                                      | Batas waktu order belum dibayar sebelum dibatalkan otomatis, default `60`                          |
| `KAFKA_BROKERS`                                             | `localhost:29093` (sesuaikan dengan port di `docker-compose.yml`)                                  |
| `KAFKA_CLIENT_ID`                                           | Nama client Kafka, bebas                                                                           |
| `OUTBOX_POLL_MS`                                            | Interval polling `outbox-relay`, default `1000`                                                    |
| `ELASTICSEARCH_URL`                                         | Default `http://localhost:9200`                                                                    |
| `ES_INDEX`                                                  | Nama index produk, default `products`                                                              |
| `NOTIFY_WEBHOOK_URL`                                        | Opsional — webhook eksternal (mis. Telegram) untuk notifikasi order                                |

## Arsitektur

```
Client ──> Express App ──┬──> Supabase/pg (data utama)
                          └──> outbox_events (event ditulis DALAM transaksi yang sama)
                                     │
                           outbox-relay (polling, SKIP LOCKED)
                                     │
                              Apache Kafka (KRaft)
                         ┌───────────┴───────────┐
                   order.events              product.events
                         │                         │
                  notification worker       search-indexer worker
                  (idempotent, DLQ)          (idempotent via versi eksternal, DLQ)
                         │                         │
                   log / webhook eksternal   Elasticsearch (index products)
                                                     │
                                          GET /api/products/search
```

- Express **tidak pernah** mengirim ke Kafka langsung — selalu lewat `outbox_events` + relay (transactional outbox pattern)
- `order-expiry` worker berjalan terjadwal, membatalkan order `pending` yang kedaluwarsa lewat fungsi transisi status yang sama dipakai webhook & admin
- Stok, harga, dan status order **selalu dibaca dari Postgres** — Elasticsearch murni read model untuk pencarian, nilainya indikatif

## Daftar Endpoint

### Auth (`/api/auth`)

| Method | Endpoint    | Auth | Deskripsi                           |
| ------ | ----------- | ---- | ----------------------------------- |
| POST   | `/register` | -    | Registrasi user baru                |
| POST   | `/login`    | -    | Login, dapat access + refresh token |
| POST   | `/refresh`  | -    | Tukar refresh token (rotation)      |
| POST   | `/logout`   | -    | Revoke refresh token                |
| GET    | `/me`       | ✅   | Data user yang login                |

### Produk & Kategori (`/api`)

| Method | Endpoint           | Auth  | Deskripsi                                                                                    |
| ------ | ------------------ | ----- | -------------------------------------------------------------------------------------------- |
| GET    | `/products`        | -     | List produk dari Postgres (pagination, filter, search `ilike`)                               |
| GET    | `/products/search` | -     | Pencarian dari Elasticsearch: relevansi, fuzzy match, filter, facet kategori & rentang harga |
| GET    | `/products/:id`    | -     | Detail produk                                                                                |
| POST   | `/products`        | Admin | Buat produk                                                                                  |
| PUT    | `/products/:id`    | Admin | Update produk (partial update didukung)                                                      |
| DELETE | `/products/:id`    | Admin | Soft delete produk                                                                           |
| GET    | `/categories`      | -     | List kategori                                                                                |
| POST   | `/categories`      | Admin | Buat kategori                                                                                |

### Cart (`/api/cart`), Checkout & Order (`/api/checkout`, `/api/orders`) — semua butuh login

Tidak berubah dari fase sebelumnya — lihat kode untuk detail.

### Webhook (`/api/webhook`) — tanpa auth JWT

| Method | Endpoint    | Deskripsi                                                 |
| ------ | ----------- | --------------------------------------------------------- |
| POST   | `/midtrans` | Notifikasi status pembayaran, verifikasi signature SHA512 |

### Admin (`/api/admin`) — wajib role admin

| Method | Endpoint             | Deskripsi                                                                                      |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/orders`            | Semua order (filter by status)                                                                 |
| PUT    | `/orders/:id/status` | Update status via state machine — **409** kalau transisi ilegal (mis. `completed` → `pending`) |
| GET    | `/reports/summary`   | Laporan total order & revenue (daily/monthly), hitung status `paid`/`shipped`/`completed`      |

## Katalog Event Kafka

| Topic                                    | Producer                                                    | Consumer         | Key            | Isi payload                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------- | ---------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `order.events`                           | checkout, webhook, admin (lewat outbox-relay)               | `notification`   | `order_id`     | `type, orderId, userId, status, totalAmount, items[], occurredAt`                                     |
| `product.events`                         | trigger Postgres pada tabel `products` (lewat outbox-relay) | `search-indexer` | `product_id`   | `type, updatedAt, product{id,name,description,price,stock,categoryId,categoryName,imageUrl,isActive}` |
| `order.events.dlq`, `product.events.dlq` | consumer yang gagal memproses                               | manual / tooling | key pesan asli | pesan asli + `error`, `attempts`, `origin`                                                            |

Semua pesan memakai envelope: `{ eventId, type, version, occurredAt, requestId, payload }`. `type` untuk order: `created, paid, failed, cancelled, shipped, completed`. Untuk produk: `created, updated, deleted`.

## Observability

Setiap request HTTP dapat `X-Request-Id` (lihat response header). ID yang sama bisa ditelusuri di:

1. Log aplikasi (morgan, token `:rid`)
2. Header pesan outbox saat direlay ke Kafka (log `outbox-relay`)
3. Log consumer (`notification`, `search-indexer`)

## Maintenance

```powershell
npm run cleanup   # hapus outbox_events & processed_events lama (retensi 7 & 30 hari)
```

## Testing

Script PowerShell per fase: `test-auth.ps1`, `test-product.ps1`, `test-cart.ps1`, `test-checkout.ps1`, `test-webhook.ps1`, `test-admin.ps1`, `test-order-integrity.ps1`. Jalankan server + semua worker (`npm run dev` + `npm run workers`) sebelum menjalankan test apa pun yang menyentuh Kafka/Elasticsearch.

Bukti race condition:

```powershell
node scripts/test-race-condition.js <tokenUserA> <tokenUserB>
```

Bukti ketahanan sistem (jalankan manual, catat hasilnya):

| #   | Skenario                        | Hasil yang diharapkan                                                    |
| --- | ------------------------------- | ------------------------------------------------------------------------ |
| 1   | Race stok terakhir              | 1x `201`, 1x `409`; stok 0; tepat 1 event `order.created`                |
| 2   | Kafka mati saat checkout        | Tetap `201`; outbox menumpuk; terkirim setelah Kafka hidup               |
| 3   | Webhook settlement 2x           | 1 event `order.paid`; panggilan kedua idempotent                         |
| 4   | Webhook pending terlambat       | Diabaikan; order tetap `paid`                                            |
| 5   | Admin transisi ilegal           | `409`, status & stok tidak berubah                                       |
| 6   | Order kedaluwarsa               | Worker membatalkan, stok kembali, event `order.cancelled`                |
| 7   | Event order duplikat (Kafka UI) | Hanya 1 notifikasi tercatat                                              |
| 8   | Pesan rusak                     | Masuk `.dlq`, pesan lain tetap diproses                                  |
| 9   | Elasticsearch mati              | CRUD & checkout normal; search balas `503`; index mengejar setelah hidup |
| 10  | Bangun ulang index              | Hapus index, `npm run republish` → search lengkap kembali                |
| 11  | Penelusuran request             | `X-Request-Id` dari checkout ketemu di log app, relay, notification      |

## Status Project

✅ **12 fase selesai** — V1 (Fase 1-6: auth, katalog, cart, checkout+race condition, Midtrans, admin) + V2 (Fase 7-12: hardening, integritas order, Kafka outbox, event-driven notification, Elasticsearch search, observability).
