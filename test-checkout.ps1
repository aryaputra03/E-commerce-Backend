# ============================================================
# CHECKOUT API TEST
# ============================================================
#
# Backend:
# http://localhost:5000/api
#
# Test:
# 1. Checkout normal
# 2. Stock tidak cukup
# 3. Cart kosong
# 4. Race condition -> scripts/test-race-condition.js
# 5. Rate limit
# 6. Riwayat order
# 7. Isolasi antar user
#
# ============================================================

$BaseUrl = "http://localhost:5000/api"

# ============================================================
# ACCOUNT
# ============================================================

$CustomerEmail = "test@mail.com"
$CustomerPassword = "secret123"

# User lain untuk test isolasi cart
$OtherCustomerEmail = "aryaaa@mail.com"
$OtherCustomerPassword = "secret12345"

$AdminEmail = "aryaa@mail.com"
$AdminPassword = "secret1234"

# ============================================================
# RATE LIMIT
# Sesuaikan dengan .env backend
# ============================================================

$CHECKOUT_RATE_LIMIT_MAX = 5

# ============================================================
# VARIABLES
# ============================================================

$customerToken = $null
$otherCustomerToken = $null
$adminToken = $null

$productId = $null
$productName = $null
$productPrice = $null
$productStock = $null

$orderId = $null

# ============================================================
# HELPER
# ============================================================

function Get-ErrorResponseBody {
    param (
        $Exception
    )

    try {
        $response = $Exception.Exception.Response

        if ($response) {
            $stream = $response.GetResponseStream()

            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                return $reader.ReadToEnd()
            }
        }
    }
    catch {
    }

    return $null
}

function Invoke-Api {
    param (
        [string]$Method,
        [string]$Url,
        [string]$Token = $null,
        $Body = $null
    )

    $headers = @{
        "Content-Type" = "application/json"
    }

    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }

    try {

        if ($null -ne $Body) {

            $jsonBody = $Body | ConvertTo-Json -Depth 10

            $response = Invoke-WebRequest `
                -Uri $Url `
                -Method $Method `
                -Headers $headers `
                -Body $jsonBody `
                -UseBasicParsing

        }
        else {

            $response = Invoke-WebRequest `
                -Uri $Url `
                -Method $Method `
                -Headers $headers `
                -UseBasicParsing
        }

        $parsed = $null

        if ($response.Content) {
            try {
                $parsed = $response.Content | ConvertFrom-Json
            }
            catch {
                $parsed = $response.Content
            }
        }

        return @{
            Success    = $true
            StatusCode = [int]$response.StatusCode
            Data       = $parsed
            Raw        = $response.Content
        }
    }
    catch {

        $statusCode = 0

        try {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        catch {
        }

        $errorBody = Get-ErrorResponseBody $_

        return @{
            Success    = $false
            StatusCode = $statusCode
            Error      = $errorBody
            Exception  = $_.Exception.Message
        }
    }
}

function Show-Response {
    param (
        $Response
    )

    if ($Response.Data) {
        $Response.Data | ConvertTo-Json -Depth 10
    }
    elseif ($Response.Error) {
        Write-Host $Response.Error
    }
    elseif ($Response.Raw) {
        Write-Host $Response.Raw
    }
}

function Pass {
    param (
        [string]$Message
    )

    Write-Host "PASS - $Message" -ForegroundColor Green
}

function Fail {
    param (
        [string]$Message
    )

    Write-Host "FAIL - $Message" -ForegroundColor Red
}

function Info {
    param (
        [string]$Message
    )

    Write-Host "INFO - $Message" -ForegroundColor Cyan
}

# ============================================================
# 0. LOGIN CUSTOMER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[0] LOGIN CUSTOMER"
Write-Host "============================================================"

$loginResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/auth/login" `
    -Body @{
        email    = $CustomerEmail
        password = $CustomerPassword
    }

if (-not $loginResponse.Success) {

    Fail "Login customer gagal. HTTP $($loginResponse.StatusCode)"
    Show-Response $loginResponse
    exit
}

$customerToken = $loginResponse.Data.data.accessToken

if (-not $customerToken) {

    Fail "accessToken customer tidak ditemukan."
    Show-Response $loginResponse
    exit
}

Pass "Login customer berhasil"

# ============================================================
# 0B. LOGIN ADMIN
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[0B] LOGIN ADMIN"
Write-Host "============================================================"

$adminLogin = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/auth/login" `
    -Body @{
        email    = $AdminEmail
        password = $AdminPassword
    }

if (-not $adminLogin.Success) {

    Fail "Login admin gagal. HTTP $($adminLogin.StatusCode)"
    Show-Response $adminLogin

}
else {

    $adminToken = $adminLogin.Data.data.accessToken

    if ($adminToken) {
        Pass "Login admin berhasil"
    }
    else {
        Fail "Token admin tidak ditemukan."
    }
}

# ============================================================
# 1. AMBIL PRODUCT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[1] AMBIL PRODUCT"
Write-Host "============================================================"

$productsResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/products?page=1&limit=100" `
    -Token $customerToken

if (-not $productsResponse.Success) {

    Fail "GET products gagal."
    Show-Response $productsResponse
    exit
}

$products = @($productsResponse.Data.data.items)

if ($products.Count -eq 0) {

    Fail "Tidak ada product."
    exit
}

# Cari product dengan stock minimal 2
$selectedProduct = $products |
    Where-Object {
        [int]$_.stock -ge 2
    } |
    Select-Object -First 1

if (-not $selectedProduct) {

    Fail "Tidak ditemukan product dengan stock >= 2."
    exit
}

$productId = $selectedProduct.id
$productName = $selectedProduct.name
$productPrice = [decimal]$selectedProduct.price
$productStock = [int]$selectedProduct.stock

Pass "Product ditemukan"

Write-Host "Product ID : $productId"
Write-Host "Name       : $productName"
Write-Host "Price      : $productPrice"
Write-Host "Stock      : $productStock"

# ============================================================
# 2. BERSIHKAN CART CUSTOMER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[2] CLEAN CART CUSTOMER"
Write-Host "============================================================"

$cartResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart" `
    -Token $customerToken

if (-not $cartResponse.Success) {

    Fail "GET cart gagal."
    Show-Response $cartResponse
    exit
}

$cartItems = @($cartResponse.Data.data.items)

foreach ($item in $cartItems) {

    $oldProductId = $item.product_id

    $delete = Invoke-Api `
        -Method "DELETE" `
        -Url "$BaseUrl/cart/items/$oldProductId" `
        -Token $customerToken

    if ($delete.Success) {
        Info "Menghapus cart item $oldProductId"
    }
}

Pass "Cart customer siap untuk test"

# ============================================================
# 3. CHECKOUT NORMAL
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[3] CHECKOUT NORMAL"
Write-Host "============================================================"

$checkoutQuantity = 1

$addResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/cart/items" `
    -Token $customerToken `
    -Body @{
        product_id = $productId
        quantity   = $checkoutQuantity
    }

if (-not $addResponse.Success) {

    Fail "Gagal menambahkan product ke cart."
    Show-Response $addResponse
    exit
}

Pass "Product berhasil ditambahkan ke cart"

# Checkout
$checkoutResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/checkout" `
    -Token $customerToken

Write-Host ""
Write-Host "Checkout response:"
Show-Response $checkoutResponse

if ($checkoutResponse.StatusCode -eq 201) {

    Pass "Checkout berhasil dengan HTTP 201"

}
else {

    Fail "Checkout harus HTTP 201, actual HTTP $($checkoutResponse.StatusCode)"
}

# Ambil order ID
if ($checkoutResponse.Data.data.id) {

    $orderId = $checkoutResponse.Data.data.id

}
elseif ($checkoutResponse.Data.data.order.id) {

    $orderId = $checkoutResponse.Data.data.order.id

}
elseif ($checkoutResponse.Data.data.order_id) {

    $orderId = $checkoutResponse.Data.data.order_id
}

if ($orderId) {

    Pass "Order ID ditemukan: $orderId"

}
else {

    Fail "Order ID tidak ditemukan pada response checkout."
}

# ============================================================
# 4. CEK STOCK SETELAH CHECKOUT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[4] VERIFY STOCK SETELAH CHECKOUT"
Write-Host "============================================================"

$expectedStock = $productStock - $checkoutQuantity

$productAfterCheckout = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/products/$productId" `
    -Token $customerToken

if (-not $productAfterCheckout.Success) {

    Fail "Gagal mengambil product setelah checkout."
    Show-Response $productAfterCheckout

}
else {

    $stockAfterCheckout = [int]$productAfterCheckout.Data.data.stock

    Write-Host "Stock sebelum : $productStock"
    Write-Host "Quantity      : $checkoutQuantity"
    Write-Host "Stock sesudah : $stockAfterCheckout"
    Write-Host "Expected      : $expectedStock"

    if ($stockAfterCheckout -eq $expectedStock) {

        Pass "Stock berkurang sesuai quantity"

    }
    else {

        Fail "Stock tidak sesuai."

    }
}

# ============================================================
# 5. CART HARUS KOSONG
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[5] VERIFY CART SETELAH CHECKOUT"
Write-Host "============================================================"

$cartAfterCheckout = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart" `
    -Token $customerToken

if (-not $cartAfterCheckout.Success) {

    Fail "GET cart gagal."
    Show-Response $cartAfterCheckout

}
else {

    $remainingItems = @($cartAfterCheckout.Data.data.items)
    $remainingTotal = [decimal]$cartAfterCheckout.Data.data.total

    if ($remainingItems.Count -eq 0 -and $remainingTotal -eq 0) {

        Pass "Cart kosong setelah checkout"

    }
    else {

        Fail "Cart masih berisi item setelah checkout"
        Show-Response $cartAfterCheckout
    }
}

# ============================================================
# 6. STOCK TIDAK CUKUP
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[6] CHECKOUT - STOCK TIDAK CUKUP"
Write-Host "============================================================"

if (-not $adminToken) {

    Fail "Test stock tidak cukup dilewati karena admin token tidak tersedia."

}
else {

    # --------------------------------------------------------
    # CATAT STOCK SEKARANG
    # --------------------------------------------------------

    $currentProduct = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/products/$productId" `
        -Token $adminToken

    if (-not $currentProduct.Success) {

        Fail "Gagal mengambil product sebelum test stock."

    }
    else {

        $currentStock = [int]$currentProduct.Data.data.stock

        Info "Stock saat ini: $currentStock"

        # ----------------------------------------------------
        # PERINGATAN
        #
        # Endpoint update product diasumsikan:
        # PUT /api/products/:id
        #
        # Sesuai controller product yang sebelumnya Anda berikan.
        # ----------------------------------------------------

        $setZeroResponse = Invoke-Api `
            -Method "PUT" `
            -Url "$BaseUrl/products/$productId" `
            -Token $adminToken `
            -Body @{
                name        = $currentProduct.Data.data.name
                description = $currentProduct.Data.data.description
                price       = $currentProduct.Data.data.price
                stock       = 0
                category_id = $currentProduct.Data.data.category_id
                image_url   = $currentProduct.Data.data.image_url
            }

        if (-not $setZeroResponse.Success) {

            Fail "Gagal mengubah stock menjadi 0."
            Show-Response $setZeroResponse

        }
        else {

            Pass "Stock product berhasil diubah menjadi 0"

            # ------------------------------------------------
            # ADD KE CART
            # ------------------------------------------------

            $addZeroStock = Invoke-Api `
                -Method "POST" `
                -Url "$BaseUrl/cart/items" `
                -Token $customerToken `
                -Body @{
                    product_id = $productId
                    quantity   = 1
                }

            if (-not $addZeroStock.Success) {

                Info "Add product stock 0 ditolak saat masuk cart."

            }
            else {

                # ------------------------------------------------
                # CHECKOUT
                # ------------------------------------------------

                $checkoutZero = Invoke-Api `
                    -Method "POST" `
                    -Url "$BaseUrl/checkout" `
                    -Token $customerToken

                Write-Host ""
                Write-Host "Checkout stock 0:"
                Show-Response $checkoutZero

                if ($checkoutZero.StatusCode -eq 409) {

                    Pass "Checkout stock tidak cukup menghasilkan HTTP 409"

                }
                else {

                    Fail "Expected HTTP 409, actual HTTP $($checkoutZero.StatusCode)"
                }
            }

            # ------------------------------------------------
            # RESTORE STOCK
            # ------------------------------------------------

            $restoreResponse = Invoke-Api `
                -Method "PUT" `
                -Url "$BaseUrl/products/$productId" `
                -Token $adminToken `
                -Body @{
                    name        = $currentProduct.Data.data.name
                    description = $currentProduct.Data.data.description
                    price       = $currentProduct.Data.data.price
                    stock       = $currentStock
                    category_id = $currentProduct.Data.data.category_id
                    image_url   = $currentProduct.Data.data.image_url
                }

            if ($restoreResponse.Success) {
                Pass "Stock dikembalikan ke $currentStock"
            }
            else {
                Fail "Gagal restore stock."
            }
        }
    }
}

# ============================================================
# 7. CART KOSONG -> CHECKOUT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[7] CHECKOUT CART KOSONG"
Write-Host "============================================================"

# Bersihkan cart
$cartBeforeEmptyCheckout = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart" `
    -Token $customerToken

if ($cartBeforeEmptyCheckout.Success) {

    $items = @($cartBeforeEmptyCheckout.Data.data.items)

    foreach ($item in $items) {

        Invoke-Api `
            -Method "DELETE" `
            -Url "$BaseUrl/cart/items/$($item.product_id)" `
            -Token $customerToken | Out-Null
    }
}

$emptyCheckout = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/checkout" `
    -Token $customerToken

Show-Response $emptyCheckout

if ($emptyCheckout.StatusCode -eq 400) {

    Pass "Checkout cart kosong menghasilkan HTTP 400"

}
else {

    Fail "Expected HTTP 400, actual HTTP $($emptyCheckout.StatusCode)"
}

# ============================================================
# 8. RATE LIMIT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[8] CHECKOUT RATE LIMIT"
Write-Host "============================================================"

Info "CHECKOUT_RATE_LIMIT_MAX = $CHECKOUT_RATE_LIMIT_MAX"

# Pastikan cart kosong.
# Request checkout akan sengaja dikirim berkali-kali.

$rateLimitResults = @()

for ($i = 1; $i -le ($CHECKOUT_RATE_LIMIT_MAX + 2); $i++) {

    $rateResponse = Invoke-Api `
        -Method "POST" `
        -Url "$BaseUrl/checkout" `
        -Token $customerToken

    $status = $rateResponse.StatusCode

    $rateLimitResults += $status

    Write-Host "Request #$i -> HTTP $status"

    if ($status -eq 429) {

        Pass "Rate limit aktif pada request #$i"
        break
    }
}

if ($rateLimitResults -contains 429) {

    Pass "Checkout rate limit menghasilkan HTTP 429"

}
else {

    Fail "Tidak mendapatkan HTTP 429."

    Write-Host "Status sequence:"
    Write-Host ($rateLimitResults -join ", ")
}

# ============================================================
# 9. RIWAYAT ORDER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[9] GET ORDER HISTORY"
Write-Host "============================================================"

if (-not $orderId) {

    Fail "Tidak bisa test order history karena orderId tidak ditemukan."

}
else {

    $ordersResponse = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/orders" `
        -Token $customerToken

    if (-not $ordersResponse.Success) {

        Fail "GET /orders gagal."
        Show-Response $ordersResponse

    }
    else {

        Show-Response $ordersResponse

        # Coba beberapa kemungkinan struktur
        $orders = @()

        if ($ordersResponse.Data.data.items) {
            $orders = @($ordersResponse.Data.data.items)
        }
        elseif ($ordersResponse.Data.data.orders) {
            $orders = @($ordersResponse.Data.data.orders)
        }
        elseif ($ordersResponse.Data.data -is [array]) {
            $orders = @($ordersResponse.Data.data)
        }

        $foundOrder = $orders |
            Where-Object {
                $_.id -eq $orderId
            } |
            Select-Object -First 1

        if ($foundOrder) {

            Pass "Order baru ditemukan di history"

        }
        else {

            Fail "Order $orderId tidak ditemukan di history"
        }
    }
}

# ============================================================
# 10. DETAIL ORDER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[10] GET ORDER DETAIL"
Write-Host "============================================================"

if (-not $orderId) {

    Fail "Order ID tidak tersedia."

}
else {

    $orderDetail = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/orders/$orderId" `
        -Token $customerToken

    if (-not $orderDetail.Success) {

        Fail "GET order detail gagal."
        Show-Response $orderDetail

    }
    else {

        Pass "GET order detail berhasil"
        Show-Response $orderDetail

        $detail = $orderDetail.Data.data

        # Coba mengambil items dari beberapa struktur umum
        $orderItems = @()

        if ($detail.items) {
            $orderItems = @($detail.items)
        }
        elseif ($detail.order.items) {
            $orderItems = @($detail.order.items)
        }

        if ($orderItems.Count -gt 0) {

            $matchingOrderItem = $orderItems |
                Where-Object {
                    $_.product_id -eq $productId
                } |
                Select-Object -First 1

            if ($matchingOrderItem) {

                Pass "Detail order memiliki product yang benar"

            }
            else {

                Fail "Product yang di-checkout tidak ditemukan pada order detail"
            }
        }
        else {

            Info "Field items tidak ditemukan pada struktur response. Cek response di atas."
        }
    }
}

# ============================================================
# 11. ISOLASI ANTAR USER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[11] ORDER ISOLATION ANTAR USER"
Write-Host "============================================================"

$otherLogin = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/auth/login" `
    -Body @{
        email    = $OtherCustomerEmail
        password = $OtherCustomerPassword
    }

if (-not $otherLogin.Success) {

    Fail "User kedua gagal login."
    Show-Response $otherLogin

}
else {

    $otherCustomerToken = $otherLogin.Data.data.accessToken

    if (-not $otherCustomerToken) {

        Fail "Token user kedua tidak ditemukan."

    }
    else {

        Pass "User kedua berhasil login"

        if (-not $orderId) {

            Fail "Order ID tidak tersedia untuk test isolation."

        }
        else {

            $otherOrderDetail = Invoke-Api `
                -Method "GET" `
                -Url "$BaseUrl/orders/$orderId" `
                -Token $otherCustomerToken

            Show-Response $otherOrderDetail

            if ($otherOrderDetail.StatusCode -eq 404) {

                Pass "User lain tidak dapat melihat order. HTTP 404"

            }
            else {

                Fail "Expected HTTP 404, actual HTTP $($otherOrderDetail.StatusCode)"
            }
        }
    }
}

# ============================================================
# SUMMARY
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "CHECKOUT TEST SELESAI"
Write-Host "============================================================"

Write-Host ""
Write-Host "Checklist:"
Write-Host "[3]  Checkout normal"
Write-Host "[6]  Stock tidak cukup -> 409"
Write-Host "[7]  Cart kosong -> 400"
Write-Host "[8]  Rate limit -> 429"
Write-Host "[9]  Order history"
Write-Host "[10] Order detail"
Write-Host "[11] Order isolation -> 404"
Write-Host ""
Write-Host "Race condition:"
Write-Host "    node scripts/test-race-condition.js"
Write-Host ""
Write-Host "============================================================"

