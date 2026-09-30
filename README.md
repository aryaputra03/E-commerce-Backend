# E-commerce Backend

Backend toko online dengan fokus pada transaksi aman dari race condition saat checkout,
terintegrasi Midtrans Sandbox. Dibangun bertahap mengikuti roadmap 6 fase.

## Status: Fase 1 — Setup Project & Autentikasi ✅ (in progress)

## Setup

1. `npm install`
2. Copy `.env.example` menjadi `.env`, isi kredensial Supabase & JWT secret
3. Jalankan `sql/schema.sql` di Supabase SQL Editor
4. `npm run dev`

## Endpoint (Fase 1)

| Method | Endpoint           | Auth | Deskripsi                                                |
| ------ | ------------------ | ---- | -------------------------------------------------------- |
| POST   | /api/auth/register | -    | Registrasi user baru (role: customer)                    |
| POST   | /api/auth/login    | -    | Login, dapat access + refresh token                      |
| POST   | /api/auth/refresh  | -    | Tukar refresh token lama dengan pasangan baru (rotation) |
| POST   | /api/auth/logout   | -    | Revoke refresh token                                     |
| GET    | /api/auth/me       | ✅   | Cek data user login (contoh endpoint terproteksi)        |
