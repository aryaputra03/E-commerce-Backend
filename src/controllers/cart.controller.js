const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

// Helper internal: ambil cart user beserta detail produknya + hitung subtotal & total.
// Dipakai berulang di getCart, addItem, updateItem, removeItem supaya response selalu konsisten
// (setiap aksi cart langsung balikin state cart terbaru, bukan cuma "berhasil").
async function buildCartResponse(userId) {
  const { data: items, error: queryError } = await supabase
    .from("cart_items")
    .select("id, quantity, product:products(id, name, price, stock, image_url)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (queryError) throw queryError;

  const mappedItems = items.map((item) => ({
    cart_item_id: item.id,
    product_id: item.product.id,
    name: item.product.name,
    price: item.product.price,
    image_url: item.product.image_url,
    stock_available: item.product.stock,
    quantity: item.quantity,
    subtotal: Number(item.product.price) * item.quantity,
  }));

  const total = mappedItems.reduce((sum, item) => sum + item.subtotal, 0);

  return { items: mappedItems, total };
}

// GET /api/cart
async function getCart(req, res, next) {
  try {
    const cart = await buildCartResponse(req.user.id);
    return success(res, 200, "Isi keranjang", cart);
  } catch (err) {
    next(err);
  }
}

// POST /api/cart/items
// body: { product_id, quantity }
async function addItem(req, res, next) {
  try {
    const userId = req.user.id;
    const { product_id, quantity } = req.body;

    const { data: product } = await supabase
      .from("products")
      .select("id, stock")
      .eq("id", product_id)
      .maybeSingle();

    if (!product) {
      return error(res, 404, "Produk tidak ditemukan");
    }

    // Cek apakah produk ini sudah ada di cart user — kalau ada, kita tambahkan quantity-nya
    const { data: existingItem } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("user_id", userId)
      .eq("product_id", product_id)
      .maybeSingle();

    const requestedQuantity = existingItem
      ? existingItem.quantity + quantity
      : quantity;

    if (requestedQuantity > product.stock) {
      return error(res, 400, `Stok tidak mencukupi, tersisa ${product.stock}`);
    }

    if (existingItem) {
      const { error: updateError } = await supabase
        .from("cart_items")
        .update({ quantity: requestedQuantity, updated_at: new Date() })
        .eq("id", existingItem.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from("cart_items")
        .insert({ user_id: userId, product_id, quantity });
      if (insertError) throw insertError;
    }

    const cart = await buildCartResponse(userId);
    return success(res, 200, "Produk berhasil ditambahkan ke keranjang", cart);
  } catch (err) {
    next(err);
  }
}

// PUT /api/cart/items/:productId
// body: { quantity } — ini SET quantity jadi angka ini, bukan nambah
async function updateItem(req, res, next) {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    const { quantity } = req.body;

    const { data: cartItem } = await supabase
      .from("cart_items")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (!cartItem) {
      return error(res, 404, "Produk tidak ada di keranjang");
    }

    const { data: product } = await supabase
      .from("products")
      .select("stock")
      .eq("id", productId)
      .single();

    if (quantity > product.stock) {
      return error(res, 400, `Stok tidak mencukupi, tersisa ${product.stock}`);
    }

    const { error: updateError } = await supabase
      .from("cart_items")
      .update({ quantity, updated_at: new Date() })
      .eq("id", cartItem.id);
    if (updateError) throw updateError;

    const cart = await buildCartResponse(userId);
    return success(res, 200, "Keranjang berhasil diperbarui", cart);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/cart/items/:productId
async function removeItem(req, res, next) {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const { data: cartItem } = await supabase
      .from("cart_items")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();

    if (!cartItem) {
      return error(res, 404, "Produk tidak ada di keranjang");
    }

    const { error: deleteError } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", cartItem.id);
    if (deleteError) throw deleteError;

    const cart = await buildCartResponse(userId);
    return success(res, 200, "Produk dihapus dari keranjang", cart);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/cart
async function clearCart(req, res, next) {
  try {
    const userId = req.user.id;

    const { error: deleteError } = await supabase
      .from("cart_items")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw deleteError;

    return success(res, 200, "Keranjang berhasil dikosongkan", {
      items: [],
      total: 0,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
