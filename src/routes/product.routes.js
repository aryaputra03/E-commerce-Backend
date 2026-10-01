const express = require("express");
const router = express.Router();
const { body, param } = require("express-validator");

const productController = require("../controllers/product.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/role.middleware");
const handleValidationErrors = require("../middlewares/validator.middleware");

// Rule validasi dipakai bersama untuk create & update produk
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

// ===== Produk — publik =====
router.get("/products", productController.getProducts);
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
  [param("id").isUUID().withMessage("id produk tidak valid"), ...productRules],
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
