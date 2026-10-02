const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/product.routes");
const cartRoutes = require("./routes/cart.routes");
const checkoutRoutes = require("./routes/checkout.routes");
const orderRoutes = require("./routes/order.routes");
const webhookRoutes = require("./routes/webhook.routes");
const adminRoutes = require("./routes/admin.routes"); // baru
const authMiddleware = require("./middlewares/auth.middleware");
const requireRole = require("./middlewares/role.middleware"); // baru dipakai di sini
const errorHandlerMiddleware = require("./middlewares/errorHandler.middleware");

const app = express();

// --- Hardening: CORS ketat ---
// Sebelumnya cors() polos mengizinkan SEMUA origin manapun untuk memanggil API ini.
// Sekarang hanya origin yang terdaftar di ALLOWED_ORIGINS (.env) yang diizinkan.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // origin undefined = request tanpa header Origin (Postman, curl, server-to-server, mobile app)
    // -> tetap diizinkan, karena itu bukan request dari browser pihak lain yang perlu dibatasi CORS.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Origin tidak diizinkan oleh kebijakan CORS"));
    }
  },
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan("dev"));
// --- Hardening: batasi ukuran body request ---
// Mencegah orang iseng kirim payload JSON raksasa untuk membebani server (bentuk DoS sederhana).
app.use(express.json({ limit: "10kb" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api", productRoutes);
app.use("/api/cart", authMiddleware, cartRoutes);
app.use("/api/checkout", authMiddleware, checkoutRoutes);
app.use("/api/orders", authMiddleware, orderRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/admin", authMiddleware, requireRole("admin"), adminRoutes); // baru

app.get("/", (req, res) => {
  res.json({ success: true, message: "E-commerce Backend API is running" });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan" });
});

app.use(errorHandlerMiddleware);

module.exports = app;
