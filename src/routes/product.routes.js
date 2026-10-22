const express = require("express");
const router = express.Router();
const { body, param, query } = require("express-validator");

const productController = require("../controllers/product.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/role.middleware");
const handleValidationErrors = require("../middlewares/validator.middleware");

// Rule validasi untuk CREATE produk — semua field wajib ada
const productRules = [
  body("name").trim().notEmpty().withMessage("Nama produk wajib diisi"),
  body("price")
    .isFloat({ gt: 0 })
    .withMessage("Price harus angka lebih dari 0"),
  body("stock").isInt({ min: 0 }).withMessage("Stock harus angka >= 0"),
  body("category_id")
    .optional({ nullable: true })
    .isUUID()
    .withMessage("category_id harus UUID valid"),
  body("description").optional().isString(),
  body("image_url").optional().isURL().withMessage("image_url harus URL valid"),
];

// Rule validasi untuk UPDATE produk — semua field opsional (partial update),
// tapi KALAU dikirim, tetap divalidasi tipe/formatnya.
const updateProductRules = [
  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Nama produk tidak boleh kosong"),
  body("price")
    .optional()
    .isFloat({ gt: 0 })
    .withMessage("Price harus angka lebih dari 0"),
  body("stock")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Stock harus angka >= 0"),
  body("category_id")
    .optional({ nullable: true })
    .isUUID()
    .withMessage("category_id harus UUID valid"),
  body("description").optional().isString(),
  body("image_url").optional().isURL().withMessage("image_url harus URL valid"),
];

// Rule validasi untuk SEARCH — semua parameter opsional, tapi kalau dikirim harus valid.
// { values: "falsy" } membuat "?q=" atau "?min_price=" (string kosong) dianggap tidak dikirim.
const searchRules = [
  // Tolak parameter ganda/objek (?limit=5&limit=7 atau ?q[a]=1). Express mengubahnya jadi array/objek,
  // dan nilai seperti itu tidak boleh sampai ke query Elasticsearch.
  query(["q", "category_id", "min_price", "max_price", "page", "limit"])
    .optional()
    .custom((value) => typeof value === "string")
    .withMessage(
      "Setiap parameter hanya boleh dikirim sekali sebagai teks biasa",
    ),
  query("q")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("q harus berupa teks")
    .trim()
    .isLength({ max: 100 })
    .withMessage("q maksimal 100 karakter"),
  query("category_id")
    .optional({ values: "falsy" })
    .isUUID()
    .withMessage("category_id harus UUID valid"),
  query("min_price")
    .optional({ values: "falsy" })
    .isFloat({ min: 0 })
    .withMessage("min_price harus angka >= 0")
    .toFloat(),
  query("max_price")
    .optional({ values: "falsy" })
    .isFloat({ min: 0 })
    .withMessage("max_price harus angka >= 0")
    .toFloat()
    .custom((max, { req }) => {
      const min = req.query.min_price;
      if (typeof min === "number" && min > max) {
        throw new Error("max_price tidak boleh lebih kecil dari min_price");
      }
      return true;
    }),
  // page <= 200 dan limit <= 50 menjaga from + size <= 10.000 (batas bawaan Elasticsearch)
  query("page")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 200 })
    .withMessage("page harus bilangan bulat 1-200")
    .toInt(),
  query("limit")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 50 })
    .withMessage("limit harus bilangan bulat 1-50")
    .toInt(),
];

// ===== Produk — publik =====
router.get("/products", productController.getProducts);
router.get(
  "/products/search",
  searchRules,
  handleValidationErrors,
  productController.searchProducts,
);

router.get(
  "/products/:id",
  param("id").isUUID().withMessage("id produk tidak valid"),
  handleValidationErrors,
  productController.getProductById,
);

// ===== Produk — admin only =====
router.post(
  "/products",
  authMiddleware,
  requireRole("admin"),
  productRules,
  handleValidationErrors,
  productController.createProduct,
);

router.put(
  "/products/:id",
  authMiddleware,
  requireRole("admin"),
  [
    param("id").isUUID().withMessage("id produk tidak valid"),
    ...updateProductRules,
  ],
  handleValidationErrors,
  productController.updateProduct,
);

router.delete(
  "/products/:id",
  authMiddleware,
  requireRole("admin"),
  param("id").isUUID().withMessage("id produk tidak valid"),
  handleValidationErrors,
  productController.deleteProduct,
);

// ===== Kategori =====
router.get("/categories", productController.getCategories);

router.post(
  "/categories",
  authMiddleware,
  requireRole("admin"),
  body("name").trim().notEmpty().withMessage("Nama kategori wajib diisi"),
  handleValidationErrors,
  productController.createCategory,
);

module.exports = router;
