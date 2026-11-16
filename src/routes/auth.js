'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { publicUser } = require('../auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
    }

    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    }
    if (!user.active) {
      if (user.role === 'seller') {
        return res.status(403).json({ error: 'Akun penjual Anda menunggu konfirmasi admin.' });
      }
      return res.status(403).json({ error: 'Akun ini dinonaktifkan. Hubungi admin BatikWangi.' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: publicUser(user) });
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || 'buyer').trim();
    const role = requestedRole === 'seller' ? 'seller' : 'buyer';
    const rawWhatsapp = String(req.body.whatsapp || '').trim();
    const whatsapp = normalizeWhatsApp(rawWhatsapp);

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Nama harus 2–100 karakter.' });
    }
    if (!EMAIL_RE.test(email) || email.length > 190) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }
    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Kata sandi minimal 8 karakter dan memuat huruf serta angka.' });
    }
    if (rawWhatsapp && !whatsapp) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Gunakan format 08xx… atau 628xx…' });
    }
    if (whatsapp && !/^628\d{8,11}$/.test(whatsapp)) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Gunakan format 08xx… atau 628xx…' });
    }
    if (role === 'seller' && !whatsapp) {
      return res.status(400).json({ error: 'Nomor WhatsApp wajib diisi untuk pendaftaran penjual.' });
    }

    const [exists] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (exists.length) {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }

    const active = role === 'buyer' ? 1 : 0;
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role, whatsapp, active) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hash, role, whatsapp, active]
    );

    if (role === 'seller') {
      // Akun penjual baru menunggu konfirmasi admin; jangan buat sesi login.
      return res.status(201).json({
        pending: true,
        user: { id: result.insertId, name, email, role, whatsapp, active: false },
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = result.insertId;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.status(201).json({
          user: { id: result.insertId, name, email, role: 'buyer', whatsapp, active: true },
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('batikwangi.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

// Penjual dan pembeli dapat memperbarui nama serta nomor WhatsApp miliknya sendiri.
router.patch('/profile', async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  try {
    const name = String(req.body.name ?? req.user.name).trim();
    const rawWhatsApp = req.body.whatsapp === undefined ? req.user.whatsapp : req.body.whatsapp;
    const whatsapp = rawWhatsApp ? normalizeWhatsApp(rawWhatsApp) : null;

    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Nama harus 2–100 karakter.' });
    if (whatsapp && (whatsapp.length < 9 || whatsapp.length > 15)) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    }

    await pool.execute('UPDATE users SET name = ?, whatsapp = ? WHERE id = ?', [name, whatsapp, req.user.id]);
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, whatsapp, active, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
