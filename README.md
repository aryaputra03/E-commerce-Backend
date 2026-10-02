# E-commerce Backend

Backend toko online dengan fokus pada transaksi aman dari race condition saat checkout,
terintegrasi Midtrans Sandbox untuk pembayaran, dan dilengkapi admin panel + laporan penjualan.

## Tech Stack

- Node.js + Express
- Supabase (PostgreSQL) — CRUD umum lewat Supabase client
- `pg` (node-postgres) — raw query + transaction untuk checkout (stock locking)
- Redis (`ioredis`) — rate limiting endpoint checkout
- Midtrans Snap — payment gateway (sandbox)
- JWT (access + refresh token dengan rotation)

## Setup

1. Clone & install dependency:

```powershell
   npm install
```

2. Copy `.env.example` menjadi `.env`, isi semua kredensial (lihat tabel environment variable di bawah)
3. Jalankan seluruh isi `sql/schema.sql` di Supabase SQL Editor
4. Jalankan Redis (lokal via Docker, atau pakai Upstash):

```powershell
   docker run -d --name redis-ecommerce -p 6379:6379 redis
```

5. Jalankan server:

```powershell
   npm run dev
```

## Environment Variables

| Variable                                                    | Keterangan                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                      | Port server, default `5000`                                                                                                                                   |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                 | Dari Supabase Project Settings → API                                                                                                                          |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`    | Koneksi pg Pool langsung — pakai Transaction Pooler Supabase (field terpisah, bukan connection string tunggal, supaya aman dari karakter spesial di password) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                   | String random panjang (generate dengan `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)                                            |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`           | Default `15m` dan `7d`                                                                                                                                        |
| `REDIS_URL`                                                 | Default `redis://127.0.0.1:6379`                                                                                                                              |
| `CHECKOUT_RATE_LIMIT_MAX`, `CHECKOUT_RATE_LIMIT_WINDOW_SEC` | Rate limit checkout per user, default 5x/60 detik                                                                                                             |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`                | Dari **dashboard.sandbox.midtrans.com** (bukan production!) → Settings → Access Keys                                                                          |
| `MIDTRANS_IS_PRODUCTION`                                    | `false` untuk development                                                                                                                                     |
| `ALLOWED_ORIGINS`                                           | Daftar origin frontend yang diizinkan CORS, pisah koma                                                                                                        |

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

| Method | Endpoint        | Auth  | Deskripsi                                |
| ------ | --------------- | ----- | ---------------------------------------- |
| GET    | `/products`     | -     | List produk (pagination, filter, search) |
| GET    | `/products/:id` | -     | Detail produk                            |
| POST   | `/products`     | Admin | Buat produk                              |
| PUT    | `/products/:id` | Admin | Update produk (partial update didukung)  |
| DELETE | `/products/:id` | Admin | Hapus produk                             |
| GET    | `/categories`   | -     | List kategori                            |
| POST   | `/categories`   | Admin | Buat kategori                            |

### Cart (`/api/cart`) — semua butuh login

| Method | Endpoint            | Deskripsi                        |
| ------ | ------------------- | -------------------------------- |
| GET    | `/`                 | Isi keranjang + subtotal + total |
| POST   | `/items`            | Tambah produk ke keranjang       |
| PUT    | `/items/:productId` | Set quantity produk di keranjang |
| DELETE | `/items/:productId` | Hapus 1 produk dari keranjang    |
| DELETE | `/`                 | Kosongkan keranjang              |

### Checkout & Order (`/api/checkout`, `/api/orders`) — semua butuh login

| Method | Endpoint      | Deskripsi                                                          |
| ------ | ------------- | ------------------------------------------------------------------ |
| POST   | `/checkout`   | Checkout isi cart (stock locking + generate payment link Midtrans) |
| GET    | `/orders`     | Riwayat order milik user                                           |
| GET    | `/orders/:id` | Detail 1 order                                                     |

### Webhook (`/api/webhook`) — tanpa auth JWT

| Method | Endpoint    | Deskripsi                                         |
| ------ | ----------- | ------------------------------------------------- |
| POST   | `/midtrans` | Terima notifikasi status pembayaran dari Midtrans |

### Admin (`/api/admin`) — wajib role admin

| Method | Endpoint             | Deskripsi                                     |
| ------ | -------------------- | --------------------------------------------- |
| GET    | `/orders`            | Semua order (filter by status)                |
| PUT    | `/orders/:id/status` | Update status order manual                    |
| GET    | `/reports/summary`   | Laporan total order & revenue (daily/monthly) |

## Fitur Utama

- **Stock locking** dengan `SELECT ... FOR UPDATE` + transaction PostgreSQL — mencegah 2 user membeli stok terakhir yang sama secara bersamaan (lihat `scripts/test-race-condition.js`)
- **Refresh token rotation** — refresh token lama otomatis tidak valid setelah dipakai sekali
- **Rate limiting checkout** berbasis Redis, per user
- **Webhook signature verification** (SHA512) + idempotency — aman dari pemalsuan notifikasi pembayaran

## Testing

Script PowerShell tersedia untuk tiap fase: `test-auth.ps1`, `test-product.ps1`, `test-cart.ps1`, `test-checkout.ps1`, `test-webhook.ps1`, `test-admin.ps1`. Jalankan server (`npm run dev`) sebelum menjalankan script test manapun.

Bukti penanganan race condition:

```powershell
node scripts/test-race-condition.js <tokenUserA> <tokenUserB>
```
