const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/product.routes"); // baru
const cartRoutes = require("./routes/cart.routes"); // baru
const checkoutRoutes = require("./routes/checkout.routes"); // baru
const orderRoutes = require("./routes/order.routes"); // baru
const webhookRoutes = require("./routes/webhook.routes"); // baru
const authMiddleware = require("./middlewares/auth.middleware"); // baru — dipakai langsung di sini
const errorHandlerMiddleware = require("./middlewares/errorHandler.middleware");

const app = express();

// Middleware global — urutan ini penting
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api", productRoutes); // baru — sudah include /products dan /categories di dalamnya
app.use("/api/cart", authMiddleware, cartRoutes); // baru — semua endpoint cart wajib login
app.use("/api/checkout", authMiddleware, checkoutRoutes); // baru
app.use("/api/orders", authMiddleware, orderRoutes); // baru
app.use("/api/webhook", webhookRoutes);

// Health check sederhana
app.get("/", (req, res) => {
  res.json({ success: true, message: "E-commerce Backend API is running" });
});

// 404 handler untuk route yang tidak terdaftar
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan" });
});

// Error handler HARUS dipasang paling akhir
app.use(errorHandlerMiddleware);

module.exports = app;
