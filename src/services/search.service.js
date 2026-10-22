// Semua pengetahuan tentang Elasticsearch ada di file ini: mapping indeks, cara menerapkan
// event produk ke indeks (dipakai worker), dan cara menyusun query pencarian (dipakai controller).
const INDEX = process.env.ES_INDEX || "products";

const indexDefinition = {
  settings: { number_of_shards: 1, number_of_replicas: 0 }, // single-node dev: replika tidak ada gunanya
  mappings: {
    properties: {
      name: { type: "text", fields: { keyword: { type: "keyword" } } }, // text = dicari; keyword = sort/exact
      description: { type: "text" },
      categoryId: { type: "keyword" }, // keyword = cocok persis (filter), tidak dipecah jadi kata
      categoryName: { type: "keyword" }, // dipakai untuk facet (terms aggregation)
      price: { type: "scaled_float", scaling_factor: 100 }, // uang 2 desimal, disimpan sebagai integer
      stock: { type: "integer" },
      imageUrl: { type: "keyword", index: false }, // hanya disimpan & dikembalikan, tidak dicari
      isActive: { type: "boolean" },
      updatedAt: { type: "date" },
    },
  },
};

// ---------- helper pengenal jenis error ----------
const statusOf = (err) => (err && err.meta && err.meta.statusCode) || (err && err.statusCode);
const errTypeOf = (err) => err && err.meta && err.meta.body && err.meta.body.error && err.meta.body.error.type;

// Error "sementara": ES mati / lambat / kewalahan. Pesan TIDAK salah, jadi jangan dibuang ke DLQ —
// tunggu sampai ES pulih lalu coba lagi.
function isTransientEsError(err) {
  const name = err && err.name;
  if (["ConnectionError", "TimeoutError", "NoLivingConnectionsError"].includes(name)) return true;
  const code = statusOf(err);
  return code === 429 || (typeof code === "number" && code >= 500);
}

function isIndexMissingError(err) {
  return statusOf(err) === 404 && errTypeOf(err) === "index_not_found_exception";
}

// ---------- membuat indeks ----------
let indexReady = false;

async function ensureIndex(es) {
  const exists = await es.indices.exists({ index: INDEX });
  if (!exists) {
    try {
      await es.indices.create({ index: INDEX, ...indexDefinition });
    } catch (err) {
      // API (atau worker lain) bisa saja membuatnya di waktu yang sama: itu bukan kegagalan.
      if (errTypeOf(err) !== "resource_already_exists_exception") throw err;
    }
  }
  indexReady = true;
}

// ---------- sisi tulis: event produk -> dokumen ES ----------
// Mengembalikan string hasil ("indexed" | "deleted" | ...) supaya worker bisa mencatatnya di log.
async function applyProductEvent(es, payload) {
  const p = payload && payload.product;
  const version = payload ? Date.parse(payload.updatedAt) : NaN; // updated_at (ms) = versi eksternal
  if (!p || !p.id || Number.isNaN(version)) {
    const e = new Error("payload event produk tidak valid");
    e.poison = true; // retry tidak akan memperbaiki pesan yang bentuknya salah -> langsung DLQ
    throw e;
  }

  const shouldRemove = payload.type === "product.deleted" || p.isActive === false;

  try {
    if (!indexReady) await ensureIndex(es);

    if (shouldRemove) {
      await es.delete({ index: INDEX, id: p.id, version, version_type: "external" });
      return "deleted";
    }

    await es.index({
      index: INDEX,
      id: p.id,
      version,
      version_type: "external", // ES hanya menerima bila versi BARU > versi tersimpan
      document: {
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        price: Number(p.price),
        stock: p.stock,
        imageUrl: p.imageUrl,
        isActive: true,
        updatedAt: payload.updatedAt,
      },
    });
    return "indexed";
  } catch (err) {
    const code = statusOf(err);

    if (isIndexMissingError(err)) {
      // Indeks dihapus saat worker jalan (mis. saat bangun ulang). Tandai belum siap; percobaan
      // berikutnya memanggil ensureIndex() lagi, lalu event yang sama diproses ulang.
      indexReady = false;
      err.transient = true;
      throw err;
    }
    if (code === 409) return "stale-ignored"; // sudah ada versi yang sama/lebih baru -> event usang
    if (code === 404) return "already-absent"; // menghapus dokumen yang memang tidak ada
    if (code === 400) err.poison = true; // mapping/dokumen ditolak ES: retry percuma
    else if (isTransientEsError(err)) err.transient = true;
    throw err;
  }
}

// ---------- sisi baca: query pencarian ----------
async function searchProducts(es, { q, categoryId, minPrice, maxPrice, page, limit }) {
  // must = menentukan relevansi (_score); filter = ya/tidak, tanpa skor, dan bisa di-cache ES.
  const must = q
    ? [{ multi_match: { query: q, fields: ["name^3", "description"], fuzziness: "AUTO" } }]
    : [{ match_all: {} }];

  const filter = [{ term: { isActive: true } }];
  if (categoryId) filter.push({ term: { categoryId } });
  if (minPrice !== undefined || maxPrice !== undefined) {
    const range = {};
    if (minPrice !== undefined) range.gte = minPrice;
    if (maxPrice !== undefined) range.lte = maxPrice;
    filter.push({ range: { price: range } });
  }

  const result = await es.search({
    index: INDEX,
    from: (page - 1) * limit,
    size: limit,
    track_total_hits: true, // tanpa ini total dipotong di 10.000
    query: { bool: { must, filter } },
    sort: q ? ["_score", { updatedAt: "desc" }] : [{ updatedAt: "desc" }],
    aggs: {
      categories: { terms: { field: "categoryName", size: 20 } },
      price_ranges: {
        range: {
          field: "price",
          ranges: [{ to: 50000 }, { from: 50000, to: 200000 }, { from: 200000, to: 1000000 }, { from: 1000000 }],
        },
      },
    },
  });

  const total = typeof result.hits.total === "number" ? result.hits.total : result.hits.total.value;

  return {
    total,
    items: result.hits.hits.map((h) => ({
      id: h._id,
      name: h._source.name,
      description: h._source.description,
      price: h._source.price,
      stock: h._source.stock, // indikatif saja; angka pasti selalu dari Postgres
      image_url: h._source.imageUrl,
      category_id: h._source.categoryId,
      category_name: h._source.categoryName,
      score: h._score ?? null,
    })),
    facets: {
      categories: result.aggregations.categories.buckets.map((b) => ({ name: b.key, count: b.doc_count })),
      price_ranges: result.aggregations.price_ranges.buckets.map((b) => ({
        from: b.from ?? null,
        to: b.to ?? null,
        count: b.doc_count,
      })),
    },
  };
}

module.exports = { INDEX, indexDefinition, ensureIndex, applyProductEvent, searchProducts, isTransientEsError, isIndexMissingError };