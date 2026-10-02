const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

const VALID_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "failed",
];

// GET /api/admin/orders?status=&page=&limit=
async function getAllOrders(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const { status } = req.query;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Beda dengan GET /orders (punya user biasa) yang di-filter .eq('user_id', req.user.id),
    // endpoint admin ini SENGAJA tidak filter user_id — admin memang harus bisa lihat semua order.
    let query = supabase
      .from("orders")
      .select(
        "id, user_id, status, total_amount, created_at, user:users(name, email)",
        {
          count: "exact",
        },
      );

    if (status) {
      query = query.eq("status", status);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, error: queryError, count } = await query;
    if (queryError) throw queryError;

    return success(res, 200, "Daftar semua order", {
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

// PUT /api/admin/orders/:id/status
// body: { status }
async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return error(res, 404, "Order tidak ditemukan");
    }

    const { data, error: updateError } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    return success(res, 200, "Status order berhasil diperbarui", data);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/reports/summary?period=daily|monthly&start_date=&end_date=
async function getSalesSummary(req, res, next) {
  try {
    const period = req.query.period === "monthly" ? "monthly" : "daily";
    const { start_date, end_date } = req.query;

    // Laporan hanya menghitung order yang SUDAH DIBAYAR — pending/cancelled/failed
    // tidak dihitung sebagai revenue, karena uangnya belum (atau tidak pernah) masuk.
    let query = supabase
      .from("orders")
      .select("id, total_amount, status, created_at")
      .in("status", ["paid", "completed"]);

    if (start_date) query = query.gte("created_at", start_date);
    if (end_date) query = query.lte("created_at", end_date);

    const { data: orders, error: queryError } = await query;
    if (queryError) throw queryError;

    // Agregasi manual di JS — cukup untuk laporan sederhana skala ini,
    // tidak perlu bikin SQL function/RPC terpisah hanya untuk GROUP BY.
    const groups = {};
    for (const order of orders) {
      const date = new Date(order.created_at);
      const key =
        period === "monthly"
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : date.toISOString().slice(0, 10); // YYYY-MM-DD

      if (!groups[key]) {
        groups[key] = { period: key, total_orders: 0, total_revenue: 0 };
      }
      groups[key].total_orders += 1;
      groups[key].total_revenue += Number(order.total_amount);
    }

    const breakdown = Object.values(groups).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    return success(res, 200, "Ringkasan laporan penjualan", {
      period_type: period,
      total_orders: orders.length,
      total_revenue: orders.reduce((sum, o) => sum + Number(o.total_amount), 0),
      breakdown,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllOrders,
  updateOrderStatus,
  getSalesSummary,
  VALID_STATUSES,
};
