# ============================================================
# TEST FASE 6 — ADMIN PANEL, LAPORAN & SECURITY HEADERS
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

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    $params = @{ Method = $Method; Uri = $Uri; Headers = $Headers }
    if ($Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        $params["ContentType"] = "application/json"
    }
    try {
        $response = Invoke-WebRequest @params -UseBasicParsing
        $parsedBody = $response.Content | ConvertFrom-Json
        return @{ StatusCode = [int]$response.StatusCode; Body = $parsedBody; RawHeaders = $response.Headers }
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        $errorBody = $null
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
        } catch {}
        return @{ StatusCode = $statusCode; Body = $errorBody; RawHeaders = $null }
    }
}

# ============================================================
Write-Section "0. LOGIN ADMIN & CUSTOMER"
# ============================================================
$loginAdmin = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{
    email = "aryaa@mail.com"; password = "secret1234"
}
$adminToken = $loginAdmin.Body.data.accessToken
if ($loginAdmin.StatusCode -eq 200) { Write-Pass "Login admin berhasil" } else { Write-Fail "Login admin gagal"; exit 1 }
$adminHeaders = @{ Authorization = "Bearer $adminToken" }

$loginCustomer = Invoke-Api -Method POST -Uri "$BaseUrl/api/auth/login" -Body @{
    email = "test@mail.com"; password = "secret123"
}
$customerToken = $loginCustomer.Body.data.accessToken
if ($loginCustomer.StatusCode -eq 200) { Write-Pass "Login customer berhasil" } else { Write-Fail "Login customer gagal"; exit 1 }
$customerHeaders = @{ Authorization = "Bearer $customerToken" }

# ============================================================
Write-Section "1. GET /admin/orders - CUSTOMER DITOLAK"
# ============================================================
$blocked = Invoke-Api -Method GET -Uri "$BaseUrl/api/admin/orders" -Headers $customerHeaders
if ($blocked.StatusCode -eq 403) {
    Write-Pass "Customer ditolak akses /admin/orders dengan HTTP 403"
} else {
    Write-Fail "Expected HTTP 403, actual HTTP $($blocked.StatusCode)"
}

# ============================================================
Write-Section "2. GET /admin/orders - ADMIN BERHASIL"
# ============================================================
$allOrders = Invoke-Api -Method GET -Uri "$BaseUrl/api/admin/orders" -Headers $adminHeaders
if ($allOrders.StatusCode -eq 200) {
    Write-Pass "Admin berhasil GET semua order. Total: $($allOrders.Body.data.pagination.total)"
} else {
    Write-Fail "Admin gagal GET /admin/orders, HTTP $($allOrders.StatusCode)"
}

if ($allOrders.Body.data.items.Count -eq 0) {
    Write-Fail "Tidak ada order sama sekali di database - jalankan test-checkout.ps1 dulu"
    exit 1
}
$targetOrder = $allOrders.Body.data.items[0]
Write-Info "Order yang akan diuji: $($targetOrder.id) (status saat ini: $($targetOrder.status))"

# ============================================================
Write-Section "3. GET /admin/orders?status=FILTER"
# ============================================================
$filtered = Invoke-Api -Method GET -Uri "$BaseUrl/api/admin/orders?status=pending" -Headers $adminHeaders
if ($filtered.StatusCode -eq 200) {
    $allPending = $true
    foreach ($o in $filtered.Body.data.items) {
        if ($o.status -ne "pending") { $allPending = $false }
    }
    if ($allPending) {
        Write-Pass "Filter status=pending menghasilkan data yang benar ($($filtered.Body.data.items.Count) order)"
    } else {
        Write-Fail "Ada order dengan status selain 'pending' di hasil filter"
    }
} else {
    Write-Fail "Filter status gagal, HTTP $($filtered.StatusCode)"
}

# ============================================================
Write-Section "4. PUT /admin/orders/:id/status - STATUS TIDAK VALID"
# ============================================================
$invalidStatus = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($targetOrder.id)/status" -Headers $adminHeaders -Body @{
    status = "statusNgasal"
}
if ($invalidStatus.StatusCode -eq 400) {
    Write-Pass "Status tidak valid ditolak dengan HTTP 400"
} else {
    Write-Fail "Expected HTTP 400, actual HTTP $($invalidStatus.StatusCode)"
}

# ============================================================
Write-Section "5. PUT /admin/orders/:id/status - CUSTOMER DITOLAK"
# ============================================================
$customerUpdate = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($targetOrder.id)/status" -Headers $customerHeaders -Body @{
    status = "shipped"
}
if ($customerUpdate.StatusCode -eq 403) {
    Write-Pass "Customer ditolak update status order dengan HTTP 403"
} else {
    Write-Fail "Expected HTTP 403, actual HTTP $($customerUpdate.StatusCode)"
}

# ============================================================
Write-Section "6. PUT /admin/orders/:id/status - ADMIN BERHASIL"
# ============================================================
$validUpdate = Invoke-Api -Method PUT -Uri "$BaseUrl/api/admin/orders/$($targetOrder.id)/status" -Headers $adminHeaders -Body @{
    status = "shipped"
}
if ($validUpdate.StatusCode -eq 200 -and $validUpdate.Body.data.status -eq "shipped") {
    Write-Pass "Admin berhasil update status order menjadi 'shipped'"
} else {
    Write-Fail "Update status gagal. HTTP $($validUpdate.StatusCode), status: $($validUpdate.Body.data.status)"
}

# ============================================================
Write-Section "7. GET /admin/reports/summary"
# ============================================================
$summary = Invoke-Api -Method GET -Uri "$BaseUrl/api/admin/reports/summary?period=daily" -Headers $adminHeaders
if ($summary.StatusCode -eq 200) {
    Write-Pass "GET reports/summary berhasil"
    Write-Info "Total orders (paid/completed): $($summary.Body.data.total_orders)"
    Write-Info "Total revenue: $($summary.Body.data.total_revenue)"
    Write-Info "Jumlah periode breakdown: $($summary.Body.data.breakdown.Count)"
} else {
    Write-Fail "GET reports/summary gagal, HTTP $($summary.StatusCode)"
}

$summaryBlocked = Invoke-Api -Method GET -Uri "$BaseUrl/api/admin/reports/summary" -Headers $customerHeaders
if ($summaryBlocked.StatusCode -eq 403) {
    Write-Pass "Customer ditolak akses reports/summary dengan HTTP 403"
} else {
    Write-Fail "Expected HTTP 403, actual HTTP $($summaryBlocked.StatusCode)"
}

# ============================================================
Write-Section "8. SECURITY HEADERS (helmet)"
# ============================================================
$headerCheck = Invoke-Api -Method GET -Uri "$BaseUrl/"
if ($headerCheck.RawHeaders) {
    $hasXContentType = $headerCheck.RawHeaders.ContainsKey("X-Content-Type-Options")
    $hasXFrame = $headerCheck.RawHeaders.ContainsKey("X-Frame-Options") -or $headerCheck.RawHeaders.ContainsKey("Content-Security-Policy")
    $hasHidePoweredBy = -not $headerCheck.RawHeaders.ContainsKey("X-Powered-By")

    if ($hasXContentType) { Write-Pass "Header X-Content-Type-Options aktif" } else { Write-Fail "Header X-Content-Type-Options TIDAK ditemukan" }
    if ($hasXFrame) { Write-Pass "Header anti-clickjacking (X-Frame-Options/CSP) aktif" } else { Write-Fail "Header anti-clickjacking TIDAK ditemukan" }
    if ($hasHidePoweredBy) { Write-Pass "Header X-Powered-By sudah disembunyikan (tidak bocorkan Express)" } else { Write-Fail "X-Powered-By masih terekspos" }
} else {
    Write-Fail "Tidak bisa membaca response headers"
}

# ============================================================
Write-Host ""
Write-Host ("=" * 60)
Write-Host "ADMIN & SECURITY TEST SELESAI"
Write-Host ("=" * 60)
Write-Host ""
Write-Host "Checklist:"
Write-Host "[2]  GET /admin/orders (admin only)"
Write-Host "[3]  Filter status bekerja benar"
Write-Host "[6]  Update status order"
Write-Host "[7]  Laporan sesuai data paid/completed"
Write-Host "[1,5,7b] Endpoint admin ditolak untuk customer (403)"
Write-Host "[8]  Security header aktif"
Write-Host ("=" * 60)