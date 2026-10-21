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
const adminRoutes = require("./routes/admin.routes");
const authMiddleware = require("./middlewares/auth.middleware");
const requireRole = require("./middlewares/role.middleware");
const requestId = require("./middlewares/requestId.middleware"); // baru
const errorHandlerMiddleware = require("./middlewares/errorHandler.middleware");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
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

// requestId dipasang SEBELUM morgan, supaya req.requestId sudah tersedia saat morgan mencatat baris log ini.
app.use(requestId);
morgan.token("rid", (req) => req.requestId);
app.use(morgan(":date[iso] :rid :method :url :status :response-time ms"));

app.use(express.json({ limit: "10kb" }));

app.use("/api/auth", authRoutes);
app.use("/api", productRoutes);
app.use("/api/cart", authMiddleware, cartRoutes);
app.use("/api/checkout", authMiddleware, checkoutRoutes);
app.use("/api/orders", authMiddleware, orderRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/admin", authMiddleware, requireRole("admin"), adminRoutes);

app.get("/", (req, res) => {
  res.json({ success: true, message: "E-commerce Backend API is running" });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan" });
});

app.use(errorHandlerMiddleware);

module.exports = app;
