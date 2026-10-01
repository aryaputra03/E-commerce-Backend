$BaseUrl = "http://localhost:5000/api/auth"

$Email = "aryaaa@mail.com"
$Password = "secret12345"
$Name = "stest arya"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AUTH API TEST" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan


# ============================================================
# HELPER
# ============================================================

function Get-StatusCode {
    param ($Exception)

    try {
        return [int]$Exception.Exception.Response.StatusCode
    }
    catch {
        return $null
    }
}


# ============================================================
# 1. REGISTER
# ============================================================

Write-Host "`n[1] REGISTER" -ForegroundColor Yellow

$registerBody = @{
    name     = $Name
    email    = $Email
    password = $Password
} | ConvertTo-Json

try {

    $registerResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/register" `
        -Method POST `
        -ContentType "application/json" `
        -Body $registerBody

    Write-Host "PASS - Register berhasil" -ForegroundColor Green

    $registerResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 409) {

        Write-Host "INFO - User sudah terdaftar, lanjut ke login" -ForegroundColor Yellow

    }
    else {

        Write-Host "FAIL - Register gagal. HTTP $statusCode" -ForegroundColor Red
        Write-Host $_.Exception.Message
        exit

    }
}


# ============================================================
# 2. LOGIN
# ============================================================

Write-Host "`n[2] LOGIN" -ForegroundColor Yellow

$loginBody = @{
    email    = $Email
    password = $Password
} | ConvertTo-Json

try {

    $loginResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody

    Write-Host "PASS - Login berhasil" -ForegroundColor Green

    # ========================================================
    # IMPORTANT:
    # Response backend:
    #
    # {
    #   success: true,
    #   message: "...",
    #   data: {
    #       user: {...},
    #       accessToken: "...",
    #       refreshToken: "..."
    #   }
    # }
    # ========================================================

    $accessToken = $loginResponse.data.accessToken
    $refreshToken = $loginResponse.data.refreshToken

    if (-not $accessToken) {

        Write-Host "FAIL - accessToken tidak ditemukan" -ForegroundColor Red
        exit

    }

    if (-not $refreshToken) {

        Write-Host "FAIL - refreshToken tidak ditemukan" -ForegroundColor Red
        exit

    }

    Write-Host "PASS - accessToken ditemukan" -ForegroundColor Green
    Write-Host "PASS - refreshToken ditemukan" -ForegroundColor Green

}
catch {

    Write-Host "FAIL - Login gagal" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit

}


# ============================================================
# 3. GET /ME DENGAN ACCESS TOKEN
# ============================================================

Write-Host "`n[3] GET /ME DENGAN ACCESS TOKEN" -ForegroundColor Yellow

$authHeaders = @{
    Authorization = "Bearer $accessToken"
}

try {

    $meResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/me" `
        -Method GET `
        -Headers $authHeaders

    Write-Host "PASS - /me berhasil dengan accessToken" -ForegroundColor Green

    $meResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - /me gagal dengan token valid. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 3B. GET /ME TANPA TOKEN
# HARUS 401
# ============================================================

Write-Host "`n[3B] GET /ME TANPA AUTHORIZATION HEADER" -ForegroundColor Yellow

try {

    $meWithoutToken = Invoke-RestMethod `
        -Uri "$BaseUrl/me" `
        -Method GET

    Write-Host "FAIL - /me tidak menolak request tanpa token" -ForegroundColor Red

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 401) {

        Write-Host "PASS - /me tanpa token menghasilkan 401" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 401, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }

}


# ============================================================
# 4. REFRESH TOKEN
# ============================================================

Write-Host "`n[4] REFRESH TOKEN" -ForegroundColor Yellow

# Simpan token lama untuk menguji rotation
$oldRefreshToken = $refreshToken

$refreshBody = @{
    refreshToken = $oldRefreshToken
} | ConvertTo-Json

try {

    $refreshResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/refresh" `
        -Method POST `
        -ContentType "application/json" `
        -Body $refreshBody

    Write-Host "PASS - Refresh berhasil" -ForegroundColor Green

    # Response kemungkinan:
    #
    # {
    #   success: true,
    #   message: "...",
    #   data: {
    #       accessToken: "...",
    #       refreshToken: "..."
    #   }
    # }

    $newAccessToken = $refreshResponse.data.accessToken
    $newRefreshToken = $refreshResponse.data.refreshToken

    if (-not $newAccessToken) {

        Write-Host "FAIL - accessToken baru tidak ditemukan" -ForegroundColor Red
        $refreshResponse | ConvertTo-Json -Depth 10
        exit

    }

    if (-not $newRefreshToken) {

        Write-Host "FAIL - refreshToken baru tidak ditemukan" -ForegroundColor Red
        $refreshResponse | ConvertTo-Json -Depth 10
        exit

    }

    Write-Host "PASS - accessToken baru ditemukan" -ForegroundColor Green
    Write-Host "PASS - refreshToken baru ditemukan" -ForegroundColor Green

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Refresh gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit

}


# ============================================================
# 4B. TEST REFRESH TOKEN ROTATION
#
# Token lama HARUS sudah tidak bisa digunakan.
# Expected: 401
# ============================================================

Write-Host "`n[4B] TEST REFRESH TOKEN ROTATION" -ForegroundColor Yellow

$oldTokenBody = @{
    refreshToken = $oldRefreshToken
} | ConvertTo-Json

try {

    $rotationResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/refresh" `
        -Method POST `
        -ContentType "application/json" `
        -Body $oldTokenBody

    Write-Host "FAIL - Refresh token lama masih bisa digunakan!" -ForegroundColor Red

    $rotationResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 401) {

        Write-Host "PASS - Refresh token lama ditolak dengan 401" -ForegroundColor Green
        Write-Host "PASS - Token rotation berjalan" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 401, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }

}


# ============================================================
# 5. LOGOUT
# ============================================================

Write-Host "`n[5] LOGOUT" -ForegroundColor Yellow

# Logout menggunakan refresh token BARU
$logoutBody = @{
    refreshToken = $newRefreshToken
} | ConvertTo-Json

try {

    $logoutResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/logout" `
        -Method POST `
        -ContentType "application/json" `
        -Body $logoutBody

    Write-Host "PASS - Logout berhasil" -ForegroundColor Green

    $logoutResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Logout gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 5B. TEST REFRESH SETELAH LOGOUT
#
# Refresh token yang sudah di-logout HARUS ditolak.
# Expected: 401
# ============================================================

Write-Host "`n[5B] TEST REFRESH SETELAH LOGOUT" -ForegroundColor Yellow

$logoutRefreshBody = @{
    refreshToken = $newRefreshToken
} | ConvertTo-Json

try {

    $afterLogoutResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/refresh" `
        -Method POST `
        -ContentType "application/json" `
        -Body $logoutRefreshBody

    Write-Host "FAIL - Refresh token masih bisa digunakan setelah logout!" -ForegroundColor Red

    $afterLogoutResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 401) {

        Write-Host "PASS - Refresh token setelah logout menghasilkan 401" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 401, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }

}


# ============================================================
# SUMMARY
# ============================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " TEST SELESAI" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan