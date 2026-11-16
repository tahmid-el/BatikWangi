'use strict';

const express = require('express');
const pool = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

function validateCategory(body) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  if (name.length < 2 || name.length > 80) return { error: 'Nama kategori harus 2–80 karakter.' };
  if (description.length > 255) return { error: 'Deskripsi kategori maksimal 255 karakter.' };
  return { name, description: description || null };
}

// Publik: semua kategori beserta jumlah produk aktif.
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.id, c.name, c.description, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    res.json({
      categories: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        productCount: Number(row.product_count),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('seller'), async (req, res, next) => {
  const data = validateCategory(req.body);
  if (data.error) return res.status(400).json({ error: data.error });
  try {
    const [result] = await pool.execute('INSERT INTO categories (name, description) VALUES (?, ?)', [
      data.name,
      data.description,
    ]);
    res.status(201).json({ category: { id: result.insertId, name: data.name, description: data.description, productCount: 0 } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Nama kategori sudah ada.' });
    next(err);
  }
});

router.put('/:id', requireRole('seller'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID kategori tidak valid.' });
  const data = validateCategory(req.body);
  if (data.error) return res.status(400).json({ error: data.error });

  try {
    const [result] = await pool.execute('UPDATE categories SET name = ?, description = ? WHERE id = ?', [
      data.name,
      data.description,
      id,
    ]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json({ category: { id, name: data.name, description: data.description } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Nama kategori sudah ada.' });
    next(err);
  }
});

router.delete('/:id', requireRole('seller'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID kategori tidak valid.' });

  try {
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM products WHERE category_id = ?', [id]);
    if (Number(total) > 0) {
      return res.status(409).json({ error: 'Kategori masih dipakai produk. Pindahkan produk terlebih dahulu.' });
    }
    const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
