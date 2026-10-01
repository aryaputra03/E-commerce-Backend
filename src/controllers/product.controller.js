const supabase = require("../config/supabase");
const { success, error } = require("../utils/response");

// GET /api/products
// Query params: page, limit, category_id, min_price, max_price, search
async function getProducts(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const { category_id, min_price, max_price, search } = req.query;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // count: 'exact' bikin Supabase sekaligus hitung total row yang cocok filter,
    // supaya kita bisa kirim total_pages ke client tanpa query kedua.
    let query = supabase
      .from("products")
      .select(
        "id, name, description, price, stock, image_url, category_id, created_at",
        {
          count: "exact",
        },
      );

    if (category_id) {
      query = query.eq("category_id", category_id);
    }
    if (min_price) {
      query = query.gte("price", Number(min_price));
    }
    if (max_price) {
      query = query.lte("price", Number(max_price));
    }
    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, error: queryError, count } = await query;
    if (queryError) throw queryError;

    return success(res, 200, "Daftar produk", {
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

// GET /api/products/:id
async function getProductById(req, res, next) {
  try {
    const { id } = req.params;

    const { data, error: queryError } = await supabase
      .from("products")
      .select(
        "id, name, description, price, stock, image_url, category_id, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (queryError) throw queryError;
    if (!data) {
      return error(res, 404, "Produk tidak ditemukan");
    }

    return success(res, 200, "Detail produk", data);
  } catch (err) {
    next(err);
  }
}

// POST /api/products (admin)
async function createProduct(req, res, next) {
  try {
    const { name, description, price, stock, category_id, image_url } =
      req.body;

    const { data, error: insertError } = await supabase
      .from("products")
      .insert({ name, description, price, stock, category_id, image_url })
      .select()
      .single();

    if (insertError) throw insertError;

    return success(res, 201, "Produk berhasil dibuat", data);
  } catch (err) {
    next(err);
  }
}

// PUT /api/products/:id (admin)
async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, price, stock, category_id, image_url } =
      req.body;

    // Cek produk ada dulu supaya bisa balas 404 yang jelas, bukan silently no-op
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return error(res, 404, "Produk tidak ditemukan");
    }

    const { data, error: updateError } = await supabase
      .from("products")
      .update({ name, description, price, stock, category_id, image_url })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    return success(res, 200, "Produk berhasil diperbarui", data);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/products/:id (admin)
async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return error(res, 404, "Produk tidak ditemukan");
    }

    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", id);
    if (deleteError) throw deleteError;

    return success(res, 200, "Produk berhasil dihapus");
  } catch (err) {
    next(err);
  }
}

// GET /api/categories
async function getCategories(req, res, next) {
  try {
    const { data, error: queryError } = await supabase
      .from("categories")
      .select("id, name")
      .order("name", { ascending: true });

    if (queryError) throw queryError;

    return success(res, 200, "Daftar kategori", data);
  } catch (err) {
    next(err);
  }
}

// POST /api/categories (admin)
async function createCategory(req, res, next) {
  try {
    const { name } = req.body;

    const { data, error: insertError } = await supabase
      .from("categories")
      .insert({ name })
      .select()
      .single();

    if (insertError) {
      // kode 23505 = unique constraint violation di Postgres (nama kategori dobel)
      if (insertError.code === "23505") {
        return error(res, 409, "Nama kategori sudah ada");
      }
      throw insertError;
    }

    return success(res, 201, "Kategori berhasil dibuat", data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  createCategory,
};
