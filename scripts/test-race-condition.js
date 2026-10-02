// Cara pakai: node scripts/test-race-condition.js <accessTokenUserA> <accessTokenUserB>
//
// Prasyarat sebelum jalanin:
// 1. Set stock 1 produk tertentu jadi 1 (lewat Supabase Table Editor atau PUT /api/products/:id)
// 2. Login sebagai User A, add produk itu ke cart-nya (quantity 1)
// 3. Login sebagai User B (akun BEDA), add produk YANG SAMA ke cart-nya (quantity 1)
// 4. Jalankan script ini dengan access token kedua user

const [, , tokenA, tokenB] = process.argv;

if (!tokenA || !tokenB) {
  console.error("Usage: node scripts/test-race-condition.js <tokenA> <tokenB>");
  process.exit(1);
}

const BASE_URL = "http://localhost:5000";

async function hitCheckout(token, label) {
  const res = await fetch(`${BASE_URL}/api/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  console.log(`[${label}] HTTP ${res.status} - ${body.message}`);
  return res.status;
}

async function run() {
  console.log(
    "Mengirim 2 request checkout secara BERSAMAAN untuk produk yang sama...\n",
  );

  const [statusA, statusB] = await Promise.all([
    hitCheckout(tokenA, "User A"),
    hitCheckout(tokenB, "User B"),
  ]);

  const successCount = [statusA, statusB].filter((s) => s === 201).length;
  const conflictCount = [statusA, statusB].filter((s) => s === 409).length;

  console.log("\n=== HASIL ===");
  console.log(`Berhasil (201): ${successCount}`);
  console.log(`Konflik (409): ${conflictCount}`);
  console.log(
    successCount === 1 && conflictCount === 1
      ? "✅ Race condition tertangani dengan benar"
      : "❌ Ada yang tidak sesuai — cek kembali locking di checkout.controller.js",
  );
}

run();
