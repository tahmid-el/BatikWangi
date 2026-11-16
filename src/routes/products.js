'use strict';

const express = require('express');
const pool = require('../db');
const { requireRole } = require('../auth');
const { upload, removeUploadedImage } = require('../upload');

const router = express.Router();

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.price, p.stock, p.featured, p.image_url,
         p.created_at, p.updated_at,
         c.id AS category_id, c.name AS category_name,
         u.id AS seller_id, u.name AS seller_name, u.whatsapp AS seller_whatsapp, u.active AS seller_active
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN users u ON u.id = p.seller_id
`;

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    stock: Number(row.stock),
    featured: Boolean(row.featured),
    imageUrl: row.image_url,
    category: { id: row.category_id, name: row.category_name },
    seller: { id: row.seller_id, name: row.seller_name, whatsapp: row.seller_whatsapp },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findProduct(id) {
  return pool.execute(`${PRODUCT_SELECT} WHERE p.id = ? LIMIT 1`, [id]);
}

/** Validasi payload produk; mengembalikan { data } atau { error }. */
function validateProduct(body, { partial = false } = {}) {
  const data = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 120) return { error: 'Nama produk harus 2–120 karakter.' };
    data.name = name;
  }

  if (body.description !== undefined || !partial) {
    const description = String(body.description || '').trim();
    if (description.length < 10 || description.length > 2000) {
      return { error: 'Deskripsi produk harus 10–2000 karakter.' };
    }
    data.description = description;
  }

  if (body.price !== undefined || !partial) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 9999999999.99) {
      return { error: 'Harga harus angka 0 atau lebih.' };
    }
    data.price = Math.round(price * 100) / 100;
  }

  if (body.stock !== undefined || !partial) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
      return { error: 'Stok harus bilangan bulat 0 atau lebih.' };
    }
    data.stock = stock;
  }

  if (body.featured !== undefined) {
    data.featured = body.featured === true || body.featured === 'true' || body.featured === '1' || body.featured === 1 ? 1 : 0;
  }

  if (body.categoryId !== undefined || !partial) {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return { error: 'Kategori wajib dipilih.' };
    data.categoryId = categoryId;
  }

  return { data };
}

/* ------------------------------- Publik -------------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const categoryId = Number(req.query.categoryId);
    const featured = req.query.featured === '1';
    const instock = req.query.instock === '1';

    const where = ['u.active = 1'];
    const params = [];

    if (search) {
      where.push('(p.name LIKE ? OR p.description LIKE ? OR u.name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (Number.isInteger(categoryId) && categoryId > 0) {
      where.push('p.category_id = ?');
      params.push(categoryId);
    }
    if (featured) where.push('p.featured = 1');
    if (instock) where.push('p.stock > 0');

    const sortMap = {
      newest: 'p.created_at DESC, p.id DESC',
      'price-asc': 'p.price ASC, p.id ASC',
      'price-desc': 'p.price DESC, p.id DESC',
      'name-asc': 'p.name ASC',
    };
    const defaultSort = 'p.featured DESC, p.created_at DESC, p.id DESC';
    const orderBy = sortMap[req.query.sort] || defaultSort;

    const [rows] = await pool.query(
      `${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
      params
    );
    res.json({ products: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID produk tidak valid.' });
    const [rows] = await findProduct(id);
    const row = rows[0];
    if (!row || !row.seller_active) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json({ product: serialize(row) });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Area seller ------------------------------- */

router.get('/seller/mine', requireRole('seller'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `${PRODUCT_SELECT} WHERE p.seller_id = ? ORDER BY p.created_at DESC, p.id DESC`,
      [req.user.id]
    );
    res.json({ products: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.get('/seller/stats', requireRole('seller'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(stock), 0) AS stock,
              SUM(featured = 1) AS featured, SUM(stock = 0) AS out_of_stock,
              COUNT(DISTINCT category_id) AS categories
       FROM products WHERE seller_id = ?`,
      [req.user.id]
    );
    const stat = rows[0];
    res.json({
      stats: {
        totalProducts: Number(stat.total),
        totalStock: Number(stat.stock),
        featured: Number(stat.featured),
        outOfStock: Number(stat.out_of_stock),
        categoriesUsed: Number(stat.categories),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/seller', requireRole('seller'), upload.single('image'), async (req, res, next) => {
  const uploadedUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const { data, error } = validateProduct(req.body);
    if (error) {
      if (uploadedUrl) removeUploadedImage(uploadedUrl);
      return res.status(400).json({ error });
    }
    if (!uploadedUrl) return res.status(400).json({ error: 'Gambar produk wajib diunggah.' });

    const [cats] = await pool.execute('SELECT id FROM categories WHERE id = ? LIMIT 1', [data.categoryId]);
    if (!cats.length) {
      removeUploadedImage(uploadedUrl);
      return res.status(400).json({ error: 'Kategori tidak ditemukan.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO products (seller_id, category_id, name, description, price, stock, featured, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, data.categoryId, data.name, data.description, data.price, data.stock, data.featured || 0, uploadedUrl]
    );
    const [rows] = await findProduct(result.insertId);
    res.status(201).json({ product: serialize(rows[0]) });
  } catch (err) {
    if (uploadedUrl) removeUploadedImage(uploadedUrl);
    next(err);
  }
});

router.put('/seller/:id', requireRole('seller'), upload.single('image'), async (req, res, next) => {
  const id = Number(req.params.id);
  const uploadedUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    if (!Number.isInteger(id) || id <= 0) {
      if (uploadedUrl) removeUploadedImage(uploadedUrl);
      return res.status(400).json({ error: 'ID produk tidak valid.' });
    }

    const [existingRows] = await pool.execute('SELECT * FROM products WHERE id = ? AND seller_id = ? LIMIT 1', [
      id,
      req.user.id,
    ]);
    const existing = existingRows[0];
    if (!existing) {
      if (uploadedUrl) removeUploadedImage(uploadedUrl);
      return res.status(404).json({ error: 'Produk tidak ditemukan atau bukan milik Anda.' });
    }

    const { data, error } = validateProduct(req.body);
    if (error) {
      if (uploadedUrl) removeUploadedImage(uploadedUrl);
      return res.status(400).json({ error });
    }

    const [cats] = await pool.execute('SELECT id FROM categories WHERE id = ? LIMIT 1', [data.categoryId]);
    if (!cats.length) {
      if (uploadedUrl) removeUploadedImage(uploadedUrl);
      return res.status(400).json({ error: 'Kategori tidak ditemukan.' });
    }

    const imageUrl = uploadedUrl || existing.image_url;
    await pool.execute(
      `UPDATE products
       SET category_id = ?, name = ?, description = ?, price = ?, stock = ?, featured = ?, image_url = ?
       WHERE id = ? AND seller_id = ?`,
      [data.categoryId, data.name, data.description, data.price, data.stock, data.featured || 0, imageUrl, id, req.user.id]
    );

    if (uploadedUrl && existing.image_url !== uploadedUrl) removeUploadedImage(existing.image_url);

    const [rows] = await findProduct(id);
    res.json({ product: serialize(rows[0]) });
  } catch (err) {
    if (uploadedUrl) removeUploadedImage(uploadedUrl);
    next(err);
  }
});

router.patch('/seller/:id/stock', requireRole('seller'), async (req, res, next) => {
  const id = Number(req.params.id);
  const stock = Number(req.body.stock);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID produk tidak valid.' });
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    return res.status(400).json({ error: 'Stok harus bilangan bulat 0 atau lebih.' });
  }
  try {
    const [result] = await pool.execute('UPDATE products SET stock = ? WHERE id = ? AND seller_id = ?', [
      stock,
      id,
      req.user.id,
    ]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Produk tidak ditemukan atau bukan milik Anda.' });
    res.json({ ok: true, stock });
  } catch (err) {
    next(err);
  }
});

router.patch('/seller/:id/featured', requireRole('seller'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID produk tidak valid.' });
  try {
    const [result] = await pool.execute(
      'UPDATE products SET featured = NOT featured WHERE id = ? AND seller_id = ?',
      [id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Produk tidak ditemukan atau bukan milik Anda.' });
    const [rows] = await pool.execute('SELECT featured FROM products WHERE id = ?', [id]);
    res.json({ ok: true, featured: Boolean(rows[0].featured) });
  } catch (err) {
    next(err);
  }
});

router.delete('/seller/:id', requireRole('seller'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID produk tidak valid.' });
  try {
    const [rows] = await pool.execute('SELECT image_url FROM products WHERE id = ? AND seller_id = ? LIMIT 1', [
      id,
      req.user.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Produk tidak ditemukan atau bukan milik Anda.' });

    await pool.execute('DELETE FROM products WHERE id = ? AND seller_id = ?', [id, req.user.id]);
    removeUploadedImage(rows[0].image_url);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
