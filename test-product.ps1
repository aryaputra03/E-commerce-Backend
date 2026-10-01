# ============================================================
# PRODUCT & CATEGORY API TEST
# ============================================================

$BaseUrl = "http://localhost:5000/api"

# ============================================================
# ACCOUNT CONFIGURATION
# ============================================================

# Admin yang sudah ada di database
$AdminEmail = "aryaa@mail.com"
$AdminPassword = "secret1234"

# Customer yang sudah ada di database
$CustomerEmail = "test@mail.com"
$CustomerPassword = "secret123"


# ============================================================
# TEST DATA
# ============================================================

$CategoryName = "Elektronik"

$Products = @(
    @{
        name        = "Laptop Elektronik"
        description = "Laptop untuk kebutuhan kerja"
        price       = 50000
        stock       = 10
    },
    @{
        name        = "Mouse Elektronik"
        description = "Mouse wireless"
        price       = 25000
        stock       = 20
    },
    @{
        name        = "Keyboard Elektronik"
        description = "Keyboard mechanical"
        price       = 75000
        stock       = 15
    }
)


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


function Login {
    param (
        [string]$Email,
        [string]$Password
    )

    $body = @{
        email    = $Email
        password = $Password
    } | ConvertTo-Json

    try {

        $response = Invoke-RestMethod `
            -Uri "$BaseUrl/auth/login" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body

        return $response.data

    }
    catch {

        Write-Host "Login gagal untuk $Email" -ForegroundColor Red
        Write-Host $_.Exception.Message

        return $null
    }
}


function Invoke-Api {
    param (
        [string]$Uri,
        [string]$Method,
        [string]$Token,
        [object]$Body
    )

    $headers = @{
        Authorization = "Bearer $Token"
    }

    $params = @{
        Uri         = $Uri
        Method      = $Method
        Headers     = $headers
        ContentType = "application/json"
    }

    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
    }

    return Invoke-RestMethod @params
}


# ============================================================
# START
# ============================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " CATEGORY & PRODUCT API TEST" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan


# ============================================================
# 0. LOGIN ADMIN
# ============================================================

Write-Host "`n[0] LOGIN ADMIN" -ForegroundColor Yellow

$admin = Login `
    -Email $AdminEmail `
    -Password $AdminPassword

if (-not $admin) {
    Write-Host "FAIL - Tidak bisa login sebagai admin" -ForegroundColor Red
    exit
}

$adminToken = $admin.accessToken

Write-Host "PASS - Login admin berhasil" -ForegroundColor Green
Write-Host "Admin token ditemukan: $($null -ne $adminToken)"


# ============================================================
# 0B. LOGIN CUSTOMER
# ============================================================

Write-Host "`n[0B] LOGIN CUSTOMER" -ForegroundColor Yellow

$customer = Login `
    -Email $CustomerEmail `
    -Password $CustomerPassword

if (-not $customer) {
    Write-Host "FAIL - Tidak bisa login sebagai customer" -ForegroundColor Red
    exit
}

$customerToken = $customer.accessToken

Write-Host "PASS - Login customer berhasil" -ForegroundColor Green
Write-Host "Customer token ditemukan: $($null -ne $customerToken)"


# ============================================================
# 1. CREATE CATEGORY - ADMIN
# ============================================================

Write-Host "`n[1] CREATE CATEGORY - ADMIN" -ForegroundColor Yellow

$categoryBody = @{
    name = $CategoryName
}

try {

    $categoryResponse = Invoke-Api `
        -Uri "$BaseUrl/categories" `
        -Method POST `
        -Token $adminToken `
        -Body $categoryBody

    Write-Host "PASS - Category berhasil dibuat" -ForegroundColor Green

    $categoryResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Create category gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

    exit
}


# ============================================================
# AMBIL CATEGORY ID
# ============================================================

$categoryData = $categoryResponse.data
$categoryId = $categoryData.id

if (-not $categoryId) {

    Write-Host "FAIL - category_id tidak ditemukan dari response" -ForegroundColor Red

    $categoryResponse | ConvertTo-Json -Depth 10

    exit
}

Write-Host "Category ID: $categoryId" -ForegroundColor Cyan


# ============================================================
# 1B. CREATE CATEGORY - CUSTOMER
# HARUS 403
# ============================================================

Write-Host "`n[1B] CREATE CATEGORY - CUSTOMER" -ForegroundColor Yellow

try {

    $customerCategoryResponse = Invoke-Api `
        -Uri "$BaseUrl/categories" `
        -Method POST `
        -Token $customerToken `
        -Body @{
            name = "Kategori Customer Test"
        }

    Write-Host "FAIL - Customer berhasil membuat category!" -ForegroundColor Red

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 403) {

        Write-Host "PASS - Customer ditolak dengan 403" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 403, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }
}


# ============================================================
# 2. CREATE PRODUCTS - ADMIN
# ============================================================

Write-Host "`n[2] CREATE PRODUCTS - ADMIN" -ForegroundColor Yellow

$productIds = @()

foreach ($product in $Products) {

    $productBody = @{
        name        = $product.name
        description = $product.description
        price       = $product.price
        stock       = $product.stock
        category_id = $categoryId
    }

    try {

        $productResponse = Invoke-Api `
            -Uri "$BaseUrl/products" `
            -Method POST `
            -Token $adminToken `
            -Body $productBody

        Write-Host "PASS - Product '$($product.name)' berhasil dibuat" -ForegroundColor Green

        $productResponse | ConvertTo-Json -Depth 10

        $productData = $productResponse.data
        $productId = $productData.id

        if ($productId) {

            $productIds += $productId

            Write-Host "Product ID: $productId" -ForegroundColor DarkGray

        }
        else {

            Write-Host "WARNING - Product berhasil dibuat tetapi ID tidak ditemukan" -ForegroundColor Yellow

        }

    }
    catch {

        $statusCode = Get-StatusCode $_

        Write-Host "FAIL - Product '$($product.name)' gagal dibuat. HTTP $statusCode" -ForegroundColor Red

        # Tampilkan response backend
        try {

            $reader = New-Object System.IO.StreamReader(
                $_.Exception.Response.GetResponseStream()
            )

            $errorBody = $reader.ReadToEnd()

            Write-Host "Response backend:" -ForegroundColor Yellow
            Write-Host $errorBody

        }
        catch {

            Write-Host $_.Exception.Message

        }

    }
}


if ($productIds.Count -eq 0) {

    Write-Host "`nFAIL - Tidak ada product yang berhasil dibuat." -ForegroundColor Red
    exit

}

Write-Host "`nJumlah product berhasil dibuat: $($productIds.Count)" -ForegroundColor Cyan


# ============================================================
# 3. GET PRODUCTS PAGINATION
# ============================================================

Write-Host "`n[3] GET PRODUCTS - PAGINATION" -ForegroundColor Yellow

try {

    $productsResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/products?page=1&limit=5" `
        -Method GET

    Write-Host "PASS - GET products berhasil" -ForegroundColor Green

    $productsResponse | ConvertTo-Json -Depth 10

    $pagination = $productsResponse.data.pagination

    $totalPages = $pagination.total_pages
    $total = $pagination.total

    Write-Host "`nTotal products : $total" -ForegroundColor Cyan
    Write-Host "Total pages    : $totalPages" -ForegroundColor Cyan

    $expectedPages = [math]::Ceiling($total / 5)

    if ($totalPages -eq $expectedPages) {

        Write-Host "PASS - total_pages sesuai" -ForegroundColor Green
        Write-Host "Expected: $expectedPages | Actual: $totalPages"

    }
    else {

        Write-Host "FAIL - total_pages tidak sesuai" -ForegroundColor Red
        Write-Host "Expected: $expectedPages | Actual: $totalPages"

    }

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - GET products gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 4. SEARCH = ELEK
# ============================================================

Write-Host "`n[4] SEARCH PRODUCTS - 'elek'" -ForegroundColor Yellow

try {

    $searchResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/products?search=elek" `
        -Method GET

    Write-Host "PASS - Search berhasil" -ForegroundColor Green

    $searchResponse | ConvertTo-Json -Depth 10

    # Controller menggunakan data.items
    $searchProducts = $searchResponse.data.items

    $searchFailed = $false

    if (-not $searchProducts) {

        Write-Host "WARNING - Tidak ada product hasil search" -ForegroundColor Yellow

    }
    else {

        foreach ($product in $searchProducts) {

            if ($product.name -notmatch "elek") {

                Write-Host "FAIL - Product '$($product.name)' tidak cocok dengan search 'elek'" -ForegroundColor Red

                $searchFailed = $true

            }

        }
    }

    if (-not $searchFailed) {

        Write-Host "PASS - Semua hasil search cocok dengan 'elek'" -ForegroundColor Green

    }

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Search gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 5. COMBINATION FILTER
#
# category_id
# min_price = 10000
# max_price = 100000
# ============================================================

Write-Host "`n[5] COMBINATION FILTER" -ForegroundColor Yellow

$filterUrl = "$BaseUrl/products?category_id=$categoryId&min_price=10000&max_price=100000"

Write-Host "URL: $filterUrl" -ForegroundColor DarkGray

try {

    $filterResponse = Invoke-RestMethod `
        -Uri $filterUrl `
        -Method GET

    Write-Host "PASS - Combination filter berhasil" -ForegroundColor Green

    $filterResponse | ConvertTo-Json -Depth 10

    # Controller menggunakan data.items
    $filteredProducts = $filterResponse.data.items

    $filterFailed = $false

    foreach ($product in $filteredProducts) {

        $price = [decimal]$product.price

        if ($product.category_id -ne $categoryId) {

            Write-Host "FAIL - Product $($product.id) memiliki category berbeda" -ForegroundColor Red

            $filterFailed = $true

        }

        if ($price -lt 10000 -or $price -gt 100000) {

            Write-Host "FAIL - Product '$($product.name)' memiliki price $price di luar range" -ForegroundColor Red

            $filterFailed = $true

        }

    }

    if (-not $filterFailed) {

        Write-Host "PASS - Semua hasil memenuhi:" -ForegroundColor Green
        Write-Host "      category_id = $categoryId"
        Write-Host "      price >= 10000"
        Write-Host "      price <= 100000"

    }

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Combination filter gagal. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 6. UPDATE PRODUCT - CUSTOMER
# HARUS 403
# ============================================================

Write-Host "`n[6] UPDATE PRODUCT - CUSTOMER" -ForegroundColor Yellow

# Gunakan product pertama
$testProductId = $productIds[0]

$customerUpdateBody = @{
    name = "Product Customer Unauthorized"
}

try {

    $customerUpdateResponse = Invoke-Api `
        -Uri "$BaseUrl/products/$testProductId" `
        -Method PUT `
        -Token $customerToken `
        -Body $customerUpdateBody

    Write-Host "FAIL - Customer berhasil update product!" -ForegroundColor Red

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 403) {

        Write-Host "PASS - Customer ditolak update dengan 403" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 403, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }

}


# ============================================================
# 6B. DELETE PRODUCT - CUSTOMER
# HARUS 403
# ============================================================

Write-Host "`n[6B] DELETE PRODUCT - CUSTOMER" -ForegroundColor Yellow

try {

    $customerDeleteResponse = Invoke-Api `
        -Uri "$BaseUrl/products/$testProductId" `
        -Method DELETE `
        -Token $customerToken `
        -Body $null

    Write-Host "FAIL - Customer berhasil delete product!" -ForegroundColor Red

}
catch {

    $statusCode = Get-StatusCode $_

    if ($statusCode -eq 403) {

        Write-Host "PASS - Customer ditolak delete dengan 403" -ForegroundColor Green

    }
    else {

        Write-Host "FAIL - Expected 403, mendapatkan HTTP $statusCode" -ForegroundColor Red

    }

}


# ============================================================
# 7. UPDATE PRODUCT - ADMIN
# HARUS BERHASIL
# ============================================================

Write-Host "`n[7] UPDATE PRODUCT - ADMIN" -ForegroundColor Cyan

# Gunakan product terakhir agar jelas product mana yang di-update
$updateProductId = $productIds[$productIds.Count - 1]

Write-Host "Product ID yang akan di-update: $updateProductId" -ForegroundColor DarkGray

$adminUpdateBody = @{
    name        = "Laptop Updated"
    description = "Laptop updated untuk testing API"
    price       = 15000000
    stock       = 25
    category_id = $categoryId
    image_url   = "https://example.com/laptop-updated.jpg"
}

try {

    $updateResponse = Invoke-Api `
        -Uri "$BaseUrl/products/$updateProductId" `
        -Method PUT `
        -Token $adminToken `
        -Body $adminUpdateBody

    Write-Host "PASS - Admin berhasil update product. HTTP 200" -ForegroundColor Green

    $updateResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Admin gagal update product. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# 8. DELETE PRODUCT - ADMIN
# HARUS BERHASIL
# ============================================================

Write-Host "`n[8] DELETE PRODUCT - ADMIN" -ForegroundColor Yellow

try {

    $adminDeleteResponse = Invoke-Api `
        -Uri "$BaseUrl/products/$updateProductId" `
        -Method DELETE `
        -Token $adminToken `
        -Body $null

    Write-Host "PASS - Admin berhasil delete product. HTTP 200" -ForegroundColor Green

    $adminDeleteResponse | ConvertTo-Json -Depth 10

}
catch {

    $statusCode = Get-StatusCode $_

    Write-Host "FAIL - Admin gagal delete product. HTTP $statusCode" -ForegroundColor Red
    Write-Host $_.Exception.Message

}


# ============================================================
# FINISH
# ============================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " TEST SELESAI" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan