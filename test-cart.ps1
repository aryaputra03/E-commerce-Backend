# ============================================================
# TEST CART API - E-COMMERCE BACKEND
# ============================================================

$BaseUrl = "http://localhost:5000/api"

# ============================================================
# CONFIG
# ============================================================

$CustomerEmail = "test@mail.com"
$CustomerPassword = "secret123"

# User lain untuk test isolasi cart
$OtherCustomerEmail = "aryaaa@mail.com"
$OtherCustomerPassword = "secret12345"

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
        return $null
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

            $response = Invoke-RestMethod `
                -Uri $Url `
                -Method $Method `
                -Headers $headers `
                -Body $jsonBody

        }
        else {
            $response = Invoke-RestMethod `
                -Uri $Url `
                -Method $Method `
                -Headers $headers
        }

        return @{
            Success    = $true
            StatusCode = 200
            Data       = $response
        }
    }
    catch {
        $errorBody = Get-ErrorResponseBody $_

        return @{
            Success    = $false
            StatusCode = [int]$_.Exception.Response.StatusCode
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
}

function Pass {
    param ([string]$Message)

    Write-Host "PASS - $Message" -ForegroundColor Green
}

function Fail {
    param ([string]$Message)

    Write-Host "FAIL - $Message" -ForegroundColor Red
}

# ============================================================
# VARIABLES
# ============================================================

$customerToken = $null
$otherCustomerToken = $null

$productId = $null
$productPrice = 0
$productStock = 0

# ============================================================
# 0. LOGIN CUSTOMER
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[0] LOGIN CUSTOMER"
Write-Host "============================================================"

$loginBody = @{
    email    = $CustomerEmail
    password = $CustomerPassword
}

$login = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/auth/login" `
    -Body $loginBody

if (-not $login.Success) {
    Fail "Login customer gagal. HTTP $($login.StatusCode)"
    Show-Response $login
    exit
}

$customerToken = $login.Data.data.accessToken

if ($customerToken) {
    Pass "Login customer berhasil"
    Write-Host "Customer token ditemukan: True"
}
else {
    Fail "Access token tidak ditemukan"
    Show-Response $login
    exit
}

# ============================================================
# 0B. AMBIL PRODUCT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[0B] AMBIL PRODUCT UNTUK TEST CART"
Write-Host "============================================================"

$productsResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/products?limit=10" `
    -Token $customerToken

if (-not $productsResponse.Success) {
    Fail "Gagal mengambil products. HTTP $($productsResponse.StatusCode)"
    Show-Response $productsResponse
    exit
}

# Response:
# data.items

$products = $productsResponse.Data.data.items

if (-not $products -or $products.Count -eq 0) {
    Fail "Tidak ada product yang tersedia untuk test cart."
    exit
}

# Cari product dengan stock > 2
$selectedProduct = $products |
    Where-Object { [int]$_.stock -gt 2 } |
    Select-Object -First 1

if (-not $selectedProduct) {
    Fail "Tidak ditemukan product dengan stock > 2."
    exit
}

$productId = $selectedProduct.id
$productPrice = [decimal]$selectedProduct.price
$productStock = [int]$selectedProduct.stock

Pass "Product ditemukan"

Write-Host "Product ID : $productId"
Write-Host "Product    : $($selectedProduct.name)"
Write-Host "Price      : $productPrice"
Write-Host "Stock      : $productStock"

# ============================================================
# 1. GET CART AWAL
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[1] GET CART AWAL"
Write-Host "============================================================"

$cartResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart" `
    -Token $customerToken

if (-not $cartResponse.Success) {
    Fail "GET cart gagal. HTTP $($cartResponse.StatusCode)"
    Show-Response $cartResponse
    exit
}

Show-Response $cartResponse

$cartData = $cartResponse.Data.data

$initialItems = @($cartData.items)
$initialTotal = [decimal]($cartData.total)

if ($initialItems.Count -eq 0 -and $initialTotal -eq 0) {
    Pass "Cart awal kosong: items=[] dan total=0"
}
else {
    Write-Host ""
    Write-Host "WARNING - Cart customer tidak kosong." -ForegroundColor Yellow
    Write-Host "Items: $($initialItems.Count)"
    Write-Host "Total: $initialTotal"

    # Bersihkan item yang sudah ada agar test berikutnya konsisten
    foreach ($item in $initialItems) {

        $oldProductId = $item.product_id

        $deleteOld = Invoke-Api `
            -Method "DELETE" `
            -Url "$BaseUrl/cart/items/$oldProductId" `
            -Token $customerToken

        if ($deleteOld.Success) {
            Write-Host "Membersihkan cart item: $oldProductId"
        }
    }

    # cek ulang
    $cartResponse = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/cart" `
        -Token $customerToken

    if ($cartResponse.Success) {
        $cartData = $cartResponse.Data.data

        if (@($cartData.items).Count -eq 0 -and [decimal]$cartData.total -eq 0) {
            Pass "Cart berhasil dibersihkan sebelum test"
        }
        else {
            Fail "Cart masih memiliki item sebelum test"
            exit
        }
    }
}

# ============================================================
# 2. POST CART ITEM - QUANTITY 2
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[2] ADD PRODUCT - QUANTITY 2"
Write-Host "============================================================"

$addBody = @{
    product_id = $productId
    quantity   = 2
}

$addResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/cart/items" `
    -Token $customerToken `
    -Body $addBody

if (-not $addResponse.Success) {
    Fail "Gagal menambahkan product. HTTP $($addResponse.StatusCode)"
    Show-Response $addResponse
    exit
}

Show-Response $addResponse

$addData = $addResponse.Data.data

# Coba beberapa kemungkinan response structure
$itemQuantity = $null
$itemSubtotal = $null
$cartTotal = $null

if ($addData.quantity -ne $null) {
    $itemQuantity = [int]$addData.quantity
}

if ($addData.subtotal -ne $null) {
    $itemSubtotal = [decimal]$addData.subtotal
}

if ($addData.total -ne $null) {
    $cartTotal = [decimal]$addData.total
}

$expectedSubtotal = $productPrice * 2

if ($itemSubtotal -ne $null) {

    if ($itemSubtotal -eq $expectedSubtotal) {
        Pass "Subtotal benar: $itemSubtotal"
    }
    else {
        Fail "Subtotal salah. Expected=$expectedSubtotal Actual=$itemSubtotal"
    }

}
else {
    Write-Host "INFO - subtotal tidak ditemukan langsung pada response POST."
}

# ============================================================
# 3. GET CART - VERIFY QUANTITY 2
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[3] VERIFY CART - QUANTITY 2"
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

Show-Response $cartResponse

$cartData = $cartResponse.Data.data
$cartItems = @($cartData.items)

$cartItem = $cartItems |
    Where-Object { $_.product_id -eq $productId } |
    Select-Object -First 1

if (-not $cartItem) {
    Fail "Product tidak ditemukan di cart."
    exit
}

$currentQuantity = [int]$cartItem.quantity
$currentSubtotal = [decimal]$cartItem.subtotal
$currentTotal = [decimal]$cartData.total

if ($currentQuantity -eq 2) {
    Pass "Quantity = 2"
}
else {
    Fail "Quantity salah. Expected=2 Actual=$currentQuantity"
}

if ($currentSubtotal -eq $expectedSubtotal) {
    Pass "Subtotal benar: $currentSubtotal"
}
else {
    Fail "Subtotal salah. Expected=$expectedSubtotal Actual=$currentSubtotal"
}

if ($currentTotal -eq $expectedSubtotal) {
    Pass "Total benar: $currentTotal"
}
else {
    Fail "Total salah. Expected=$expectedSubtotal Actual=$currentTotal"
}

# ============================================================
# 4. ADD PRODUCT YANG SAMA - QUANTITY 1
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[4] ADD PRODUCT YANG SAMA - QUANTITY 1"
Write-Host "============================================================"

$addAgainBody = @{
    product_id = $productId
    quantity   = 1
}

$addAgainResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/cart/items" `
    -Token $customerToken `
    -Body $addAgainBody

if (-not $addAgainResponse.Success) {
    Fail "Gagal menambahkan product kedua kali."
    Show-Response $addAgainResponse
    exit
}

# Cek cart
$cartResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart" `
    -Token $customerToken

if (-not $cartResponse.Success) {
    Fail "GET cart gagal."
    exit
}

$cartData = $cartResponse.Data.data
$cartItems = @($cartData.items)

$matchingItems = @(
    $cartItems | Where-Object {
        $_.product_id -eq $productId
    }
)

if ($matchingItems.Count -eq 1) {
    Pass "Product tetap menjadi 1 baris (tidak duplikat)"
}
else {
    Fail "Product menjadi $($matchingItems.Count) baris di cart."
}

$cartItem = $matchingItems | Select-Object -First 1

$quantityAfterSecondAdd = [int]$cartItem.quantity

if ($quantityAfterSecondAdd -eq 3) {
    Pass "Quantity menjadi 3"
}
else {
    Fail "Quantity salah. Expected=3 Actual=$quantityAfterSecondAdd"
}

$expectedSubtotal3 = $productPrice * 3
$currentSubtotal = [decimal]$cartItem.subtotal
$currentTotal = [decimal]$cartData.total

if ($currentSubtotal -eq $expectedSubtotal3) {
    Pass "Subtotal setelah add kedua benar: $currentSubtotal"
}
else {
    Fail "Subtotal salah. Expected=$expectedSubtotal3 Actual=$currentSubtotal"
}

if ($currentTotal -eq $expectedSubtotal3) {
    Pass "Total setelah add kedua benar: $currentTotal"
}
else {
    Fail "Total salah. Expected=$expectedSubtotal3 Actual=$currentTotal"
}

# ============================================================
# 5. QUANTITY MELEBIHI STOCK
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[5] TEST QUANTITY MELEBIHI STOCK"
Write-Host "============================================================"

# quantity dibuat lebih besar dari stock
$exceedQuantity = $productStock + 1

$exceedBody = @{
    product_id = $productId
    quantity   = $exceedQuantity
}

$exceedResponse = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/cart/items" `
    -Token $customerToken `
    -Body $exceedBody

Write-Host "Request quantity: $exceedQuantity"
Write-Host "Product stock   : $productStock"

if (-not $exceedResponse.Success) {

    Write-Host "HTTP Status: $($exceedResponse.StatusCode)"

    if ($exceedResponse.StatusCode -eq 400) {
        Pass "Quantity melebihi stock ditolak dengan HTTP 400"
    }
    else {
        Fail "Expected HTTP 400, Actual HTTP $($exceedResponse.StatusCode)"
    }

    Show-Response $exceedResponse
}
else {
    Fail "Backend menerima quantity melebihi stock."
    Show-Response $exceedResponse
}

# ============================================================
# 6. PUT QUANTITY MENJADI 1
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[6] UPDATE CART ITEM - QUANTITY 1"
Write-Host "============================================================"

$updateBody = @{
    quantity = 1
}

$updateResponse = Invoke-Api `
    -Method "PUT" `
    -Url "$BaseUrl/cart/items/$productId" `
    -Token $customerToken `
    -Body $updateBody

if (-not $updateResponse.Success) {
    Fail "Update cart gagal. HTTP $($updateResponse.StatusCode)"
    Show-Response $updateResponse
}
else {

    Show-Response $updateResponse

    # GET ulang untuk memastikan
    $cartResponse = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/cart" `
        -Token $customerToken

    if ($cartResponse.Success) {

        $cartData = $cartResponse.Data.data
        $cartItems = @($cartData.items)

        $cartItem = $cartItems |
            Where-Object { $_.product_id -eq $productId } |
            Select-Object -First 1

        if ($cartItem) {

            $updatedQuantity = [int]$cartItem.quantity

            if ($updatedQuantity -eq 1) {
                Pass "Quantity berhasil diubah menjadi 1 persis"
            }
            else {
                Fail "Quantity salah. Expected=1 Actual=$updatedQuantity"
            }

            $expectedSubtotal1 = $productPrice

            if ([decimal]$cartItem.subtotal -eq $expectedSubtotal1) {
                Pass "Subtotal setelah update benar: $expectedSubtotal1"
            }
            else {
                Fail "Subtotal salah setelah update"
            }

        }
        else {
            Fail "Product hilang setelah update."
        }
    }
}

# ============================================================
# 7. DELETE CART ITEM
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[7] DELETE CART ITEM"
Write-Host "============================================================"

$deleteResponse = Invoke-Api `
    -Method "DELETE" `
    -Url "$BaseUrl/cart/items/$productId" `
    -Token $customerToken

if (-not $deleteResponse.Success) {
    Fail "Delete cart item gagal. HTTP $($deleteResponse.StatusCode)"
    Show-Response $deleteResponse
}
else {

    Pass "Delete cart item berhasil"

    # Verify item hilang
    $cartResponse = Invoke-Api `
        -Method "GET" `
        -Url "$BaseUrl/cart" `
        -Token $customerToken

    if ($cartResponse.Success) {

        $cartData = $cartResponse.Data.data
        $cartItems = @($cartData.items)

        $deletedItem = $cartItems |
            Where-Object { $_.product_id -eq $productId }

        if (-not $deletedItem) {
            Pass "Product sudah hilang dari cart"
        }
        else {
            Fail "Product masih ada di cart setelah delete"
        }

        if ($cartItems.Count -eq 0 -and [decimal]$cartData.total -eq 0) {
            Pass "Cart kembali kosong"
        }
    }
}

# ============================================================
# 8. LOGIN USER LAIN
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[8] LOGIN USER LAIN - CART ISOLATION"
Write-Host "============================================================"

$otherLoginBody = @{
    email    = $OtherCustomerEmail
    password = $OtherCustomerPassword
}

$otherLogin = Invoke-Api `
    -Method "POST" `
    -Url "$BaseUrl/auth/login" `
    -Body $otherLoginBody

if (-not $otherLogin.Success) {

    Write-Host ""
    Write-Host "WARNING - User kedua tidak bisa login." -ForegroundColor Yellow
    Write-Host "Pastikan account berikut memang sudah ada:"
    Write-Host "$OtherCustomerEmail"

    Show-Response $otherLogin

}
else {

    $otherCustomerToken = $otherLogin.Data.data.accessToken

    if (-not $otherCustomerToken) {

        Fail "Token user kedua tidak ditemukan."

    }
    else {

        Pass "Login user kedua berhasil"

        # GET cart user kedua
        $otherCartResponse = Invoke-Api `
            -Method "GET" `
            -Url "$BaseUrl/cart" `
            -Token $otherCustomerToken

        if (-not $otherCartResponse.Success) {

            Fail "GET cart user kedua gagal."
            Show-Response $otherCartResponse

        }
        else {

            Show-Response $otherCartResponse

            $otherCartData = $otherCartResponse.Data.data
            $otherCartItems = @($otherCartData.items)
            $otherCartTotal = [decimal]$otherCartData.total

            if ($otherCartItems.Count -eq 0 -and $otherCartTotal -eq 0) {
                Pass "Cart user lain kosong - data cart tidak tercampur"
            }
            else {
                Fail "Cart user lain tidak kosong."
                Write-Host "Items: $($otherCartItems.Count)"
                Write-Host "Total: $otherCartTotal"
            }
        }
    }
}

# ============================================================
# 9. GET CART TANPA AUTHORIZATION
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "[9] GET CART TANPA AUTHORIZATION"
Write-Host "============================================================"

$noAuthResponse = Invoke-Api `
    -Method "GET" `
    -Url "$BaseUrl/cart"

if (-not $noAuthResponse.Success) {

    if ($noAuthResponse.StatusCode -eq 401) {
        Pass "GET cart tanpa token ditolak dengan HTTP 401"
    }
    else {
        Fail "Expected HTTP 401, Actual HTTP $($noAuthResponse.StatusCode)"
    }

    Show-Response $noAuthResponse

}
else {

    Fail "GET cart tanpa Authorization berhasil. Seharusnya HTTP 401."

    Show-Response $noAuthResponse
}

# ============================================================
# SUMMARY
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "CART API TEST SELESAI"
Write-Host "============================================================"

Write-Host ""
Write-Host "Endpoint yang diuji:"
Write-Host "1. POST /api/auth/login"
Write-Host "2. GET  /api/products"
Write-Host "3. GET  /api/cart"
Write-Host "4. POST /api/cart/items"
Write-Host "5. POST /api/cart/items (duplicate product)"
Write-Host "6. POST /api/cart/items (exceed stock)"
Write-Host "7. PUT  /api/cart/items/:productId"
Write-Host "8. DELETE /api/cart/items/:productId"
Write-Host "9. GET  /api/cart (user lain)"
Write-Host "10. GET /api/cart (without Authorization)"
Write-Host ""
Write-Host "============================================================"