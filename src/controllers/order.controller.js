const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

// GET /api/orders — riwayat order milik user yang login
async function getOrders(req, res, next) {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      50,
    );
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const {
      data,
      error: queryError,
      count,
    } = await supabase
      .from("orders")
      .select("id, status, total_amount, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (queryError) throw queryError;

    return success(res, 200, "Riwayat order", {
      items: data,
      pagination: {
        page,
        limit,
        total: count,
        total_pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/orders/:id — detail 1 order beserta item-nya
async function getOrderById(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, total_amount, created_at")
      .eq("id", id)
      .eq("user_id", userId) // penting: pastikan order ini benar milik user yang request
      .maybeSingle();

    if (!order) {
      return error(res, 404, "Order tidak ditemukan");
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select(
        "product_id, quantity, price_at_time, product:products(name, image_url)",
      )
      .eq("order_id", id);

    if (itemsError) throw itemsError;

    return success(res, 200, "Detail order", { ...order, items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOrders, getOrderById };
