'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole, publicUser } = require('../auth');
const { removeUploadedImage } = require('../upload');

const router = express.Router();

router.use(requireRole('admin'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'seller', 'buyer'];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

function isPasswordStrong(password) {
  return typeof password === 'string' && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

async function countOtherActiveAdmins(excludeId) {
  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1 AND id <> ?",
    [excludeId]
  );
  return Number(total);
}

/* --------------------------------- Users -------------------------------- */

router.get('/users', async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const role = String(req.query.role || '');
    const search = String(req.query.search || '').trim();

    if (ROLES.includes(role)) {
      where.push('role = ?');
      params.push(role);
    }
    if (search) {
      where.push('(name LIKE ? OR email LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }

    const [rows] = await pool.query(
      `SELECT id, name, email, role, whatsapp, active, created_at
       FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY FIELD(role, 'admin', 'seller', 'buyer'), created_at DESC, id DESC`,
      params
    );

    const [productCounts] = await pool.query('SELECT seller_id, COUNT(*) AS total FROM products GROUP BY seller_id');
    const countBySeller = new Map(productCounts.map((row) => [row.seller_id, Number(row.total)]));

    res.json({
      users: rows.map((row) => ({ ...publicUser(row), productCount: countBySeller.get(row.id) || 0 })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = String(req.body.role || '');
    const whatsapp = normalizeWhatsApp(req.body.whatsapp);
    const active = req.body.active === false || req.body.active === 'false' ? 0 : 1;

    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Nama harus 2–100 karakter.' });
    if (!EMAIL_RE.test(email) || email.length > 190) return res.status(400).json({ error: 'Format email tidak valid.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Kata sandi minimal 8 karakter dan memuat huruf serta angka.' });
    }
    if (whatsapp && (whatsapp.length < 9 || whatsapp.length > 15)) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    }

    const [exists] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (exists.length) return res.status(409).json({ error: 'Email sudah terdaftar.' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role, whatsapp, active) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hash, role, whatsapp, active]
    );
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, whatsapp, active, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ user: { ...publicUser(rows[0]), productCount: 0 } });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID user tidak valid.' });

  try {
    const [existingRows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'User tidak ditemukan.' });

    const name = String(req.body.name ?? existing.name).trim();
    const email = normalizeEmail(req.body.email ?? existing.email);
    const role = String(req.body.role ?? existing.role);
    const whatsapp = req.body.whatsapp === undefined ? existing.whatsapp : normalizeWhatsApp(req.body.whatsapp);
    const active = req.body.active === undefined ? Number(existing.active) : req.body.active ? 1 : 0;
    const password = req.body.password ? String(req.body.password) : null;

    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Nama harus 2–100 karakter.' });
    if (!EMAIL_RE.test(email) || email.length > 190) return res.status(400).json({ error: 'Format email tidak valid.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    if (whatsapp && (whatsapp.length < 9 || whatsapp.length > 15)) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    }
    if (password && !isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Kata sandi minimal 8 karakter dan memuat huruf serta angka.' });
    }
    if (id === req.user.id && (role !== existing.role || !active)) {
      return res.status(400).json({ error: 'Anda tidak dapat mengubah role atau menonaktifkan akun sendiri.' });
    }
    if (existing.role === 'admin' && (role !== 'admin' || !active) && Number(existing.active)) {
      if ((await countOtherActiveAdmins(id)) === 0) {
        return res.status(409).json({ error: 'Harus ada minimal satu admin aktif lain.' });
      }
    }

    const fields = ['name = ?', 'email = ?', 'role = ?', 'whatsapp = ?', 'active = ?'];
    const params = [name, email, role, whatsapp, active];
    if (password) {
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 12));
    }
    params.push(id);

    try {
      await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email sudah dipakai user lain.' });
      throw err;
    }

    const [rows] = await pool.execute(
      'SELECT id, name, email, role, whatsapp, active, created_at FROM users WHERE id = ?',
      [id]
    );
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM products WHERE seller_id = ?', [id]);
    res.json({ user: { ...publicUser(rows[0]), productCount: Number(total) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID user tidak valid.' });
  if (id === req.user.id) return res.status(400).json({ error: 'Anda tidak dapat menghapus akun sendiri.' });

  try {
    const [existingRows] = await pool.execute('SELECT id, role, active FROM users WHERE id = ? LIMIT 1', [id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'User tidak ditemukan.' });
    if (existing.role === 'admin' && existing.active && (await countOtherActiveAdmins(id)) === 0) {
      return res.status(409).json({ error: 'Harus ada minimal satu admin aktif lain.' });
    }

    const [imageRows] = await pool.execute('SELECT image_url FROM products WHERE seller_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    imageRows.forEach((row) => removeUploadedImage(row.image_url));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- Stats --------------------------------- */

router.get('/stats', async (req, res, next) => {
  try {
    const [[users]] = await pool.query(`
      SELECT COUNT(*) AS total,
             SUM(role = 'admin') AS admins,
             SUM(role = 'seller') AS sellers,
             SUM(role = 'buyer') AS buyers,
             SUM(active = 0) AS inactive
      FROM users
    `);
    const [[products]] = await pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(stock), 0) AS stock,
             SUM(featured = 1) AS featured,
             SUM(stock = 0) AS out_of_stock
      FROM products
    `);
    const [[categories]] = await pool.query('SELECT COUNT(*) AS total FROM categories');
    const [recent] = await pool.query(
      'SELECT id, name, email, role, whatsapp, active, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 5'
    );

    res.json({
      stats: {
        users: {
          total: Number(users.total),
          admins: Number(users.admins),
          sellers: Number(users.sellers),
          buyers: Number(users.buyers),
          inactive: Number(users.inactive),
        },
        products: {
          total: Number(products.total),
          stock: Number(products.stock),
          featured: Number(products.featured),
          outOfStock: Number(products.out_of_stock),
        },
        categories: Number(categories.total),
        recentUsers: recent.map(publicUser),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
