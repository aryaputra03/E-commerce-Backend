const supabase = require("../config/supabase");
const pool = require("../config/pg"); // baru — dipakai khusus untuk query laporan
const { success, error } = require("../utils/response");

const VALID_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "failed",
];

// GET /api/admin/orders?status=&page=&limit=  (tidak berubah dari Fase 6)
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

    let query = supabase
      .from("orders")
      .select(
        "id, user_id, status, total_amount, created_at, user:users(name, email)",
        {
          count: "exact",
        },
      );

    if (status) query = query.eq("status", status);

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

// PUT /api/admin/orders/:id/status (tidak berubah dari Fase 6)
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
// DIUBAH TOTAL: agregasi sekarang dilakukan di database lewat GROUP BY,
// dan sekarang ikut menghitung order berstatus 'shipped' (dulu cuma paid/completed —
// order yang sudah dikirim tapi belum ditandai "completed" hilang dari laporan).
async function getSalesSummary(req, res, next) {
  try {
    const period = req.query.period === "monthly" ? "month" : "day"; // date_trunc butuh 'day'/'month'
    const { start_date, end_date } = req.query;

    const conditions = [`status IN ('paid', 'shipped', 'completed')`];
    const params = [period];
    let paramIndex = 2;

    if (start_date) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(end_date);
      paramIndex++;
    }

    // Asumsi: created_at tersimpan sebagai UTC (bawaan default Supabase/Postgres timestamp tanpa zona).
    // date_trunc dilakukan SETELAH dikonversi ke Asia/Jakarta, supaya order jam 23:30 WIB
    // (yang nilainya sudah lewat tengah malam UTC) tetap masuk hitungan hari yang benar.
    const sql = `
      SELECT
        to_char(
          date_trunc($1::text, (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta'),
          CASE WHEN $1::text = 'month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END
        ) AS period,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(total_amount), 0)::numeric AS total_revenue
      FROM orders
      WHERE ${conditions.join(" AND ")}
      GROUP BY 1
      ORDER BY 1;
    `;

    const { rows: breakdown } = await pool.query(sql, params);

    const grandTotal = breakdown.reduce(
      (acc, row) => {
        acc.total_orders += row.total_orders;
        acc.total_revenue += Number(row.total_revenue);
        return acc;
      },
      { total_orders: 0, total_revenue: 0 },
    );

    return success(res, 200, "Ringkasan laporan penjualan", {
      period_type: req.query.period === "monthly" ? "monthly" : "daily",
      total_orders: grandTotal.total_orders,
      total_revenue: grandTotal.total_revenue,
      breakdown: breakdown.map((row) => ({
        period: row.period,
        total_orders: row.total_orders,
        total_revenue: Number(row.total_revenue),
      })),
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
