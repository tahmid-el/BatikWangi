'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const BANK_NAME = process.env.BANK_NAME || 'Bank BRI';
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || '1234-01-000000-56-7';
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || 'BatikWangi UMKM';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

async function fetchOrderWithItems(conn, orderId) {
  const [orderRows] = await conn.execute(
    `SELECT id, buyer_id, buyer_name, buyer_email, buyer_whatsapp, total_amount, payment_method, status, transfer_reference, created_at, updated_at
     FROM orders WHERE id = ? LIMIT 1`,
    [orderId]
  );
  const order = orderRows[0];
  if (!order) return null;
  const [itemRows] = await conn.execute(
    `SELECT id, product_id, seller_id, product_name, price, quantity, subtotal
     FROM order_items WHERE order_id = ? ORDER BY id ASC`,
    [orderId]
  );
  return {
    id: order.id,
    buyerId: order.buyer_id,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    buyerWhatsapp: order.buyer_whatsapp,
    totalAmount: Number(order.total_amount),
    paymentMethod: order.payment_method,
    status: order.status,
    transferReference: order.transfer_reference,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: itemRows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      sellerId: row.seller_id,
      productName: row.product_name,
      price: Number(row.price),
      quantity: Number(row.quantity),
      subtotal: Number(row.subtotal),
    })),
  };
}

/* ----------------------------- Buat pesanan ---------------------------- */

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesanan dari jaringan ini. Coba lagi nanti.' },
});

router.post('/', orderLimiter, async (req, res, next) => {
  if (req.user && req.user.role !== 'buyer') {
    return res.status(403).json({ error: 'Hanya pembeli yang dapat melakukan pembelian.' });
  }
  const conn = await pool.getConnection();
  try {
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }

    // Agregasi item dengan productId yang sama.
    const qtyByProduct = new Map();
    for (const item of rawItems) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Produk tidak valid.' });
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        return res.status(400).json({ error: 'Jumlah pesanan tidak valid.' });
      }
      qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + quantity);
    }

    const buyerName = String(req.body.buyer?.name || req.user?.name || '').trim();
    const buyerEmailRaw = String(req.body.buyer?.email || req.user?.email || '').trim();
    const buyerEmail = buyerEmailRaw ? buyerEmailRaw.toLowerCase() : null;
    const buyerWhatsapp = normalizeWhatsApp(req.body.buyer?.whatsapp || req.user?.whatsapp || '');

    if (buyerName.length < 2 || buyerName.length > 100) {
      return res.status(400).json({ error: 'Nama pembeli harus 2–100 karakter.' });
    }
    if (buyerEmail && (!EMAIL_RE.test(buyerEmail) || buyerEmail.length > 190)) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }
    if (buyerWhatsapp && !/^628\d{8,11}$/.test(buyerWhatsapp)) {
      return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    }

    await conn.beginTransaction();

    let totalAmount = 0;
    const orderItems = [];
    for (const [productId, quantity] of qtyByProduct.entries()) {
      const [productRows] = await conn.execute(
        `SELECT p.id, p.name, p.price, p.stock, p.seller_id, u.active AS seller_active
         FROM products p JOIN users u ON u.id = p.seller_id
         WHERE p.id = ? LIMIT 1 FOR UPDATE`,
        [productId]
      );
      const product = productRows[0];
      if (!product || !product.seller_active) {
        await conn.rollback();
        return res.status(404).json({ error: 'Produk tidak ditemukan.' });
      }
      if (Number(product.stock) < quantity) {
        await conn.rollback();
        return res.status(409).json({ error: `Stok ${product.name} tidak mencukupi.` });
      }
      const price = Number(product.price);
      const subtotal = Math.round(price * quantity * 100) / 100;
      totalAmount += subtotal;
      orderItems.push({ productId, sellerId: product.seller_id, productName: product.name, price, quantity, subtotal });
    }
    totalAmount = Math.round(totalAmount * 100) / 100;

    const buyerId = req.user && req.user.role === 'buyer' ? req.user.id : (req.user ? req.user.id : null);
    const [orderResult] = await conn.execute(
      `INSERT INTO orders (buyer_id, buyer_name, buyer_email, buyer_whatsapp, total_amount, payment_method, status)
       VALUES (?, ?, ?, ?, ?, 'transfer', 'pending_payment')`,
      [buyerId, buyerName, buyerEmail, buyerWhatsapp, totalAmount]
    );
    const orderId = orderResult.insertId;

    for (const item of orderItems) {
      await conn.execute(
        `INSERT INTO order_items (order_id, product_id, seller_id, product_name, price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.productId, item.sellerId, item.productName, item.price, item.quantity, item.subtotal]
      );
      await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.productId]);
    }

    await conn.commit();

    const order = await fetchOrderWithItems(pool, orderId);
    res.status(201).json({
      order,
      payment: {
        method: 'transfer',
        bankName: BANK_NAME,
        accountNumber: BANK_ACCOUNT_NUMBER,
        accountName: BANK_ACCOUNT_NAME,
        amount: totalAmount,
        reference: `BW-${orderId}`,
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    next(err);
  } finally {
    conn.release();
  }
});

/* ----------------------------- Pesanan saya ---------------------------- */

router.get('/mine', requireRole('buyer'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id FROM orders WHERE buyer_id = ? ORDER BY created_at DESC, id DESC`,
      [req.user.id]
    );
    const orders = [];
    for (const row of rows) {
      const order = await fetchOrderWithItems(pool, row.id);
      if (order) orders.push(order);
    }
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- Admin: daftar --------------------------- */

router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id FROM orders ORDER BY created_at DESC, id DESC');
    const orders = [];
    for (const row of rows) {
      const order = await fetchOrderWithItems(pool, row.id);
      if (order) orders.push(order);
    }
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- Admin: status --------------------------- */

router.patch('/:id/status', requireRole('admin'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID pesanan tidak valid.' });

  const status = String(req.body.status || '');
  const allowed = ['pending_payment', 'paid', 'cancelled', 'completed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Status pesanan tidak valid.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT status FROM orders WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    }
    const previousStatus = rows[0].status;

    // Kembalikan stok jika pesanan dibatalkan dari status aktif.
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]);
      for (const item of items) {
        if (item.product_id) {
          await conn.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
        }
      }
    }

    // Jika dibatalkan lalu diaktifkan lagi, kurangi stok kembali (best-effort).
    if (previousStatus === 'cancelled' && status !== 'cancelled') {
      const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]);
      for (const item of items) {
        if (item.product_id) {
          const [prodRows] = await conn.execute('SELECT stock FROM products WHERE id = ? LIMIT 1', [item.product_id]);
          if (prodRows.length && Number(prodRows[0].stock) < item.quantity) {
            await conn.rollback();
            return res.status(409).json({ error: 'Stok produk tidak mencukupi untuk mengaktifkan kembali pesanan.' });
          }
          await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
        }
      }
    }

    await conn.execute('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    await conn.commit();

    const order = await fetchOrderWithItems(pool, id);
    res.json({ order });
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
