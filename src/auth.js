'use strict';

const pool = require('./db');

const ROLE_LABELS = { admin: 'Admin', seller: 'Seller', buyer: 'Pembeli' };

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    whatsapp: row.whatsapp,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

/** Muat ulang user dari database agar perubahan role/status langsung berlaku. */
async function loadSessionUser(req, res, next) {
  res.locals.user = null;
  if (!req.session || !req.session.userId) return next();

  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, whatsapp, active, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    const user = rows[0];
    if (!user || !user.active) {
      return req.session.destroy(() => next());
    }
    req.user = publicUser(user);
    res.locals.user = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk aksi ini.' });
    }
    next();
  };
}

module.exports = { publicUser, loadSessionUser, requireAuth, requireRole, ROLE_LABELS };
