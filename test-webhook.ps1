# ============================================================
# TEST FASE 5 — MIDTRANS PAYMENT & WEBHOOK
# ============================================================

$BaseUrl = "http://localhost:5000"

function Write-Pass($msg) { Write-Host "PASS - $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "FAIL - $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "INFO - $msg" -ForegroundColor Cyan }
function Write-Section($title) {
    Write-Host ""
    Write-Host ("=" * 60)
    Write-Host "[$title]"
    Write-Host ("=" * 60)
}

# Baca MIDTRANS_SERVER_KEY langsung dari .env supaya signature yang kita
# hitung di sini SELALU sinkron dengan server key yang dipakai backend.
function Get-EnvValue($key) {
    $envPath = Join-Path $PSScriptRoot ".env"
    if (-not (Test-Path $envPath)) {
        throw "File .env tidak ditemukan di $envPath"
    }
    $line = Get-Content $envPath | Where-Object { $_ -match "^$key=" }
    if (-not $line) {
        throw "$key tidak ditemukan di .env"
    }
    return ($line -split "=", 2)[1].Trim()
}

$MidtransServerKey = Get-EnvValue "MIDTRANS_SERVER_KEY"

# Hitung signature SHA512 persis sesuai rumus resmi Midtrans:
# SHA512(order_id + status_code + gross_amount + ServerKey)
function Get-MidtransSignature($orderId, $statusCode, $grossAmount) {
    $stringToHash = "$orderId$statusCode$grossAmount$MidtransServerKey"
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($stringToHash)
    $hashBytes = $sha512.ComputeHash($bytes)
    return ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# Wrapper request yang menangkap status code meskipun response-nya error (4xx/5xx),
# supaya kita bisa tetap cek HTTP status tanpa script berhenti karena exception.
function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    $params = @{
        Method  = $Method
        Uri     = $Uri
        Headers = $Headers
    }
    if ($Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        $params["ContentType"] = "application/json"
    }
    try {
        # Invoke-WebRequest (bukan Invoke-RestMethod) supaya status code HTTP asli
        # bisa dibaca lewat $response.StatusCode — Invoke-RestMethod tidak menyediakan ini.
        $response = Invoke-WebRequest @params -UseBasicParsing
        $parsedBody = $response.Content | ConvertFrom-Json
        return @{ StatusCode = [int]$response.StatusCode; Body = $parsedBody }
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        $errorBody = $null
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
        } catch {}
        return @{ StatusCode = $statusCode; Body = $errorBody }
    }
}

# ============================================================
Write-Section "0. LOGIN CUSTOMER"
# ============================================================
$loginCustomer = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{
    email    = "test@mail.com"
    password = "secret123"
}
if ($loginCustomer.StatusCode -eq 200) {
    $customerToken = $loginCustomer.Body.data.accessToken
    Write-Pass "Login customer berhasil"
} else {
    Write-Fail "Login customer gagal, HTTP $($loginCustomer.StatusCode)"
    exit 1
}
$customerHeaders = @{ Authorization = "Bearer $customerToken" }

# ============================================================
Write-Section "0B. LOGIN ADMIN"
# ============================================================
$loginAdmin = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{
    email    = "aryaa@mail.com"
    password = "secret1234"
}
if ($loginAdmin.StatusCode -eq 200) {
    $adminToken = $loginAdmin.Body.data.accessToken
    Write-Pass "Login admin berhasil"
} else {
    Write-Fail "Login admin gagal, HTTP $($loginAdmin.StatusCode)"
    exit 1
}
$adminHeaders = @{ Authorization = "Bearer $adminToken" }

# ============================================================
Write-Section "1. AMBIL PRODUCT & PASTIKAN STOK CUKUP"
# ============================================================
$productsResp = Invoke-Api -Method GET -Uri "$BaseUrl/api/products?limit=1" -Headers $customerHeaders
if ($productsResp.StatusCode -ne 200 -or $productsResp.Body.data.items.Count -eq 0) {
    Write-Fail "Tidak ada product tersedia untuk test"
    exit 1
}
$product = $productsResp.Body.data.items[0]
Write-Pass "Product ditemukan: $($product.name) (stock: $($product.stock))"

if ($product.stock -lt 2) {
    Invoke-Api -Method PUT -Uri "$BaseUrl/api/products/$($product.id)" -Headers $adminHeaders -Body @{ stock = 50 } | Out-Null
    Write-Info "Stock product di-set ulang ke 50 supaya cukup untuk 2x checkout"
}

# ============================================================
Write-Section "2. BERSIHKAN CART CUSTOMER"
# ============================================================
Invoke-Api -Method DELETE -Uri "$BaseUrl/api/cart" -Headers $customerHeaders | Out-Null
Write-Pass "Cart customer dikosongkan"

# ============================================================
Write-Section "3. CHECKOUT - CEK PAYMENT LINK TERGENERATE"
# ============================================================
Invoke-Api -Method POST -Uri "$BaseUrl/api/cart/items" -Headers $customerHeaders -Body @{
    product_id = $product.id
    quantity   = 1
} | Out-Null

$checkoutResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/checkout" -Headers $customerHeaders

if ($checkoutResp.StatusCode -ne 201) {
    Write-Fail "Checkout gagal, HTTP $($checkoutResp.StatusCode)"
    exit 1
}
Write-Pass "Checkout berhasil dengan HTTP 201"

$orderId = $checkoutResp.Body.data.order.id
$grossAmount = $checkoutResp.Body.data.order.total_amount
$paymentInfo = $checkoutResp.Body.data.payment

Write-Info "Order ID    : $orderId"
Write-Info "Gross amount: $grossAmount"

if ($paymentInfo -and $paymentInfo.redirect_url) {
    Write-Pass "payment.redirect_url ditemukan: $($paymentInfo.redirect_url)"
} else {
    Write-Fail "payment.redirect_url TIDAK ditemukan di response checkout"
}

if ($paymentInfo -and $paymentInfo.token) {
    Write-Pass "payment.token (Snap token) ditemukan"
} else {
    Write-Fail "payment.token TIDAK ditemukan di response checkout"
}

# Format gross_amount harus string 2 desimal, PERSIS seperti yang dikirim Midtrans asli
$formattedAmount = [string]::Format("{0:0.00}", [double]$grossAmount)

# ============================================================
Write-Section "4. WEBHOOK - SIGNATURE TIDAK VALID"
# ============================================================
$statusCode = "200"
$validSignature = Get-MidtransSignature -orderId $orderId -statusCode $statusCode -grossAmount $formattedAmount
$tamperedSignature = $validSignature.Substring(0, $validSignature.Length - 4) + "ffff"  # rusak 4 karakter terakhir

$invalidWebhookResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id           = $orderId
    status_code        = $statusCode
    gross_amount       = $formattedAmount
    signature_key      = $tamperedSignature
    transaction_status = "settlement"
    fraud_status       = "accept"
}

if ($invalidWebhookResp.StatusCode -eq 401) {
    Write-Pass "Webhook dengan signature tidak valid ditolak dengan HTTP 401"
} else {
    Write-Fail "Expected HTTP 401, actual HTTP $($invalidWebhookResp.StatusCode)"
}

# Pastikan status order TIDAK berubah akibat webhook palsu di atas
$orderCheck1 = Invoke-Api -Method GET -Uri "$BaseUrl/api/orders/$orderId" -Headers $customerHeaders
if ($orderCheck1.Body.data.status -eq "pending") {
    Write-Pass "Status order tetap 'pending' setelah webhook signature invalid (data tidak berubah)"
} else {
    Write-Fail "Status order berubah jadi '$($orderCheck1.Body.data.status)' padahal signature invalid!"
}

# ============================================================
Write-Section "5. WEBHOOK - SIGNATURE VALID (settlement)"
# ============================================================
$validWebhookResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id           = $orderId
    status_code        = $statusCode
    gross_amount       = $formattedAmount
    signature_key      = $validSignature
    transaction_status = "settlement"
    fraud_status       = "accept"
}

if ($validWebhookResp.StatusCode -eq 200) {
    Write-Pass "Webhook dengan signature valid diterima dengan HTTP 200"
} else {
    Write-Fail "Expected HTTP 200, actual HTTP $($validWebhookResp.StatusCode)"
}

$orderCheck2 = Invoke-Api -Method GET -Uri "$BaseUrl/api/orders/$orderId" -Headers $customerHeaders
if ($orderCheck2.Body.data.status -eq "paid") {
    Write-Pass "Status order berhasil berubah menjadi 'paid'"
} else {
    Write-Fail "Status order masih '$($orderCheck2.Body.data.status)', seharusnya 'paid'"
}

# ============================================================
Write-Section "6. WEBHOOK - IDEMPOTENCY (kirim ulang payload sama)"
# ============================================================
$repeatWebhookResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id           = $orderId
    status_code        = $statusCode
    gross_amount       = $formattedAmount
    signature_key      = $validSignature
    transaction_status = "settlement"
    fraud_status       = "accept"
}

if ($repeatWebhookResp.StatusCode -eq 200) {
    Write-Pass "Webhook kedua (duplikat) tetap diterima HTTP 200"
    if ($repeatWebhookResp.Body.message -match "idempoten") {
        Write-Pass "Message mengonfirmasi idempotency: `"$($repeatWebhookResp.Body.message)`""
    } else {
        Write-Info "Message: $($repeatWebhookResp.Body.message)"
    }
} else {
    Write-Fail "Expected HTTP 200, actual HTTP $($repeatWebhookResp.StatusCode)"
}

$orderCheck3 = Invoke-Api -Method GET -Uri "$BaseUrl/api/orders/$orderId" -Headers $customerHeaders
if ($orderCheck3.Body.data.status -eq "paid") {
    Write-Pass "Status order tetap 'paid' (tidak rusak akibat webhook duplikat)"
} else {
    Write-Fail "Status order berubah jadi '$($orderCheck3.Body.data.status)' setelah webhook duplikat!"
}

# ============================================================
Write-Section "7. WEBHOOK - ORDER_ID TIDAK DIKENAL"
# ============================================================
$fakeOrderId = [guid]::NewGuid().ToString()
$fakeSignature = Get-MidtransSignature -orderId $fakeOrderId -statusCode $statusCode -grossAmount "10000.00"

$unknownOrderResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id           = $fakeOrderId
    status_code        = $statusCode
    gross_amount       = "10000.00"
    signature_key      = $fakeSignature
    transaction_status = "settlement"
    fraud_status       = "accept"
}

if ($unknownOrderResp.StatusCode -eq 200) {
    Write-Pass "Webhook untuk order_id tidak dikenal tetap dibalas HTTP 200 (diabaikan, bukan error)"
} else {
    Write-Fail "Expected HTTP 200, actual HTTP $($unknownOrderResp.StatusCode)"
}

# ============================================================
Write-Section "8. WEBHOOK - PAYLOAD TIDAK LENGKAP"
# ============================================================
$incompleteResp = Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $orderId
}

if ($incompleteResp.StatusCode -eq 400) {
    Write-Pass "Webhook dengan payload tidak lengkap ditolak dengan HTTP 400"
} else {
    Write-Fail "Expected HTTP 400, actual HTTP $($incompleteResp.StatusCode)"
}

# ============================================================
Write-Host ""
Write-Host ("=" * 60)
Write-Host "WEBHOOK TEST SELESAI"
Write-Host ("=" * 60)
Write-Host ""
Write-Host "Checklist:"
Write-Host "[3] Payment link & token tergenerate saat checkout"
Write-Host "[4] Signature tidak valid -> 401, data tidak berubah"
Write-Host "[5] Signature valid -> status order jadi 'paid'"
Write-Host "[6] Webhook duplikat -> idempotent, tidak merusak data"
Write-Host "[7] Order tidak dikenal -> 200, diabaikan"
Write-Host "[8] Payload tidak lengkap -> 400"
Write-Host ("=" * 60)