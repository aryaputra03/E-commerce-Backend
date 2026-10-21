const pool = require("../config/pg");
const supabase = require("../config/supabase");
const { transitionOrder } = require("../services/orderStatus.service"); // baru
const { success, error } = require("../utils/response");

const VALID_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "completed",
  "cancelled",
  "failed",
];

// PUT /api/admin/orders/:id/status — DIUBAH TOTAL, sekarang lewat transitionOrder
async function updateOrderStatus(req, res, next) {
  const { id } = req.params;
  const { status } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await transitionOrder(client, id, status, {
      source: "admin",
      requestId: req.requestId,
    });

    await client.query("COMMIT");

    if (!result.ok) {
      if (result.reason === "NOT_FOUND") {
        return error(res, 404, "Order tidak ditemukan");
      }
      // ILLEGAL_TRANSITION
      return error(
        res,
        409,
        `Transisi ${result.from} ke ${result.to} tidak diizinkan`,
      );
    }

    return success(
      res,
      200,
      result.changed
        ? "Status order berhasil diperbarui"
        : "Status sudah sesuai, tidak ada perubahan",
      { order_id: id, status: result.to },
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/admin/orders
async function getAllOrders(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const values = [];
    let statusFilter = "";

    if (req.query.status) {
      values.push(req.query.status);
      statusFilter = `WHERE o.status = $${values.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM orders o ${statusFilter}`,
      values,
    );
    values.push(limit, offset);
    const ordersResult = await pool.query(
      `SELECT o.id, o.user_id, u.name AS customer_name, u.email AS customer_email,
              o.status, o.total_amount, o.created_at
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ${statusFilter}
       ORDER BY o.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return success(res, 200, "Daftar order", {
      items: ordersResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        total_pages: Math.ceil(countResult.rows[0].total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/reports/summary
async function getSalesSummary(req, res, next) {
  try {
    const period = req.query.period === "daily" ? "day" : "month";
    const result = await pool.query(
      `SELECT date_trunc($1, created_at) AS period,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount), 0)::numeric(14, 2) AS revenue
       FROM orders
       WHERE status IN ('paid', 'shipped', 'completed')
       GROUP BY date_trunc($1, created_at)
       ORDER BY period DESC`,
      [period],
    );

    return success(res, 200, "Ringkasan penjualan", {
      period: req.query.period || "monthly",
      items: result.rows,
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
