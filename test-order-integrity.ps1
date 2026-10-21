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

function Get-EnvValue($key) {
    $line = Get-Content (Join-Path $PSScriptRoot ".env") | Where-Object { $_ -match "^$key=" }
    return ($line -split "=", 2)[1].Trim()
}
$MidtransServerKey = Get-EnvValue "MIDTRANS_SERVER_KEY"

function Get-MidtransSignature($orderId, $statusCode, $grossAmount) {
    $stringToHash = "$orderId$statusCode$grossAmount$MidtransServerKey"
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($stringToHash)
    $hashBytes = $sha512.ComputeHash($bytes)
    return ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Invoke-Api {
    param([string]$Method, [string]$Uri, [hashtable]$Headers = @{}, [object]$Body = $null)
    $params = @{ Method = $Method; Uri = $Uri; Headers = $Headers }
    if ($Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        $params["ContentType"] = "application/json"
    }
    try {
        $response = Invoke-WebRequest @params -UseBasicParsing
        return @{ StatusCode = [int]$response.StatusCode; Body = ($response.Content | ConvertFrom-Json) }
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        $errBody = $null
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd() | ConvertFrom-Json
        } catch {}
        return @{ StatusCode = $statusCode; Body = $errBody }
    }
}

function New-TestOrder($headers, $productId) {
    Invoke-Api -Method POST -Uri "$BaseUrl/api/cart/items" -Headers $headers -Body @{ product_id = $productId; quantity = 1 } | Out-Null
    $checkout = Invoke-Api -Method POST -Uri "$BaseUrl/api/checkout" -Headers $headers
    return $checkout.Body.data.order
}

# ============================================================
Write-Section "0. LOGIN & PRODUK"
# ============================================================
$admin = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{ email = "aryaa@mail.com"; password = "secret1234" }
$adminHeaders = @{ Authorization = "Bearer $($admin.Body.data.accessToken)" }
$customer = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{ email = "test@mail.com"; password = "secret123" }
$customerHeaders = @{ Authorization = "Bearer $($customer.Body.data.accessToken)" }
Write-Pass "Login admin & customer berhasil"

$products = Invoke-Api -Method GET -Uri "$BaseUrl/api/products?limit=1" -Headers $customerHeaders
$product = $products.Body.data.items[0]
if ($product.stock -lt 5) {
    Invoke-Api -Method PUT -Uri "$BaseUrl/api/products/$($product.id)" -Headers $adminHeaders -Body @{ stock = 20 } | Out-Null
}
Invoke-Api -Method DELETE -Uri "$BaseUrl/api/cart" -Headers $customerHeaders | Out-Null

# ============================================================
Write-Section "1. WEBHOOK CANCEL DUA KALI - STOK KEMBALI SEKALI"
# ============================================================
$stockBefore = (Invoke-Api -Method GET -Uri "$BaseUrl/api/products/$($product.id)").Body.data.stock
$order1 = New-TestOrder $customerHeaders $product.id
$amount1 = [string]::Format("{0:0.00}", [double]$order1.total_amount)
$sig1 = Get-MidtransSignature -orderId $order1.id -statusCode "200" -grossAmount $amount1

Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $order1.id; status_code = "200"; gross_amount = $amount1
    signature_key = $sig1; transaction_status = "cancel"; fraud_status = "accept"
} | Out-Null
Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $order1.id; status_code = "200"; gross_amount = $amount1
    signature_key = $sig1; transaction_status = "cancel"; fraud_status = "accept"
} | Out-Null

$stockAfter = (Invoke-Api -Method GET -Uri "$BaseUrl/api/products/$($product.id)").Body.data.stock
if ($stockAfter -eq $stockBefore) {
    Write-Pass "Stok kembali TEPAT SEKALI setelah 2x webhook cancel (before=$stockBefore, after=$stockAfter)"
} else {
    Write-Fail "Stok tidak sesuai! before=$stockBefore, after=$stockAfter (seharusnya sama)"
}

# ============================================================
Write-Section "2. WEBHOOK PENDING TERLAMBAT - TIDAK TURUNKAN STATUS PAID"
# ============================================================
$order2 = New-TestOrder $customerHeaders $product.id
$amount2 = [string]::Format("{0:0.00}", [double]$order2.total_amount)
$sigSettlement = Get-MidtransSignature -orderId $order2.id -statusCode "200" -grossAmount $amount2

Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $order2.id; status_code = "200"; gross_amount = $amount2
    signature_key = $sigSettlement; transaction_status = "settlement"; fraud_status = "accept"
} | Out-Null

$orderCheck = Invoke-Api -Method GET -Uri "$BaseUrl/api/orders/$($order2.id)" -Headers $customerHeaders
if ($orderCheck.Body.data.status -eq "paid") { Write-Pass "Order berhasil jadi 'paid' via settlement" } else { Write-Fail "Order gagal jadi 'paid'" }

Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $order2.id; status_code = "200"; gross_amount = $amount2
    signature_key = $sigSettlement; transaction_status = "pending"; fraud_status = "accept"
} | Out-Null

$orderCheck2 = Invoke-Api -Method GET -Uri "$BaseUrl/api/orders/$($order2.id)" -Headers $customerHeaders
if ($orderCheck2.Body.data.status -eq "paid") {
    Write-Pass "Webhook 'pending' terlambat TIDAK menurunkan order dari 'paid'"
} else {
    Write-Fail "Order malah turun jadi '$($orderCheck2.Body.data.status)' - BUG!"
}

# ============================================================
Write-Section "3. ADMIN: paid -> shipped -> completed, lalu completed -> pending DITOLAK"
# ============================================================
$shipResp = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($order2.id)/status" -Headers $adminHeaders -Body @{ status = "shipped" }
if ($shipResp.StatusCode -eq 200 -and $shipResp.Body.data.status -eq "shipped") {
    Write-Pass "Admin berhasil ubah paid -> shipped"
} else {
    Write-Fail "Gagal ubah ke shipped, HTTP $($shipResp.StatusCode)"
}

$completeResp = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($order2.id)/status" -Headers $adminHeaders -Body @{ status = "completed" }
Write-Info "shipped -> completed: HTTP $($completeResp.StatusCode)"

$illegalResp = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($order2.id)/status" -Headers $adminHeaders -Body @{ status = "pending" }
if ($illegalResp.StatusCode -eq 409) {
    Write-Pass "Admin DITOLAK ubah completed -> pending dengan HTTP 409"
    Write-Info "Pesan: $($illegalResp.Body.message)"
} else {
    Write-Fail "Expected HTTP 409, actual HTTP $($illegalResp.StatusCode)"
}

# ============================================================
Write-Section "4. ADMIN BATALKAN ORDER 'paid' - STOK KEMBALI"
# ============================================================
$order3 = New-TestOrder $customerHeaders $product.id
$amount3 = [string]::Format("{0:0.00}", [double]$order3.total_amount)
$sig3 = Get-MidtransSignature -orderId $order3.id -statusCode "200" -grossAmount $amount3
Invoke-Api -Method POST -Uri "$BaseUrl/api/webhook/midtrans" -Body @{
    order_id = $order3.id; status_code = "200"; gross_amount = $amount3
    signature_key = $sig3; transaction_status = "settlement"; fraud_status = "accept"
} | Out-Null

$stockBeforeCancel = (Invoke-Api -Method GET -Uri "$BaseUrl/api/products/$($product.id)").Body.data.stock
$cancelResp = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($order3.id)/status" -Headers $adminHeaders -Body @{ status = "cancelled" }
$stockAfterCancel = (Invoke-Api -Method GET -Uri "$BaseUrl/api/products/$($product.id)").Body.data.stock

if ($cancelResp.StatusCode -eq 200 -and $cancelResp.Body.data.status -eq "cancelled" -and $stockAfterCancel -eq ($stockBeforeCancel + 1)) {
    Write-Pass "Admin batalkan order 'paid' -> status cancelled, stok kembali (+1)"
} else {
    Write-Fail "Gagal. Status: $($cancelResp.Body.data.status), stock before=$stockBeforeCancel after=$stockAfterCancel"
}

# ============================================================
Write-Host ""
Write-Host ("=" * 60)
Write-Host "ORDER INTEGRITY TEST SELESAI"
Write-Host ("=" * 60)