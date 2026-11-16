'use strict';

/**
 * Seeder BatikWangi.
 *   npm run db:seed          -> buat database/tabel, isi data hanya jika kosong
 *   npm run db:reset         -> hapus tabel lalu isi ulang data dummy dari awal
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_NAME = process.env.DB_NAME || 'batikwangi';
const RESET = process.argv.includes('--reset');

const CATEGORIES = [
  { name: 'Batik Tulis', description: 'Batik tulis tangan pengrajin Banyuwangi' },
  { name: 'Batik Cap', description: 'Batik cap dengan motif khas Blambangan' },
  { name: 'Kebaya', description: 'Kebaya Osing, kutubaru, dan encim' },
  { name: 'Aksesoris & Bawahan', description: 'Selendang, rok lilit, dan pelengkap busana' },
];

const USERS = [
  { name: 'Admin BatikWangi', email: 'admin@batikwangi.id', password: 'Admin#12345', role: 'admin', whatsapp: '6281234567890' },
  { name: 'Sari Wulandari', email: 'seller1@batikwangi.id', password: 'Seller#12345', role: 'seller', whatsapp: '6281234567891' },
  { name: 'Bagus Prakoso', email: 'seller2@batikwangi.id', password: 'Seller#12345', role: 'seller', whatsapp: '6281234567892' },
  { name: 'Dewi Lestari', email: 'buyer1@batikwangi.id', password: 'Pembeli#12345', role: 'buyer', whatsapp: '6281234567893' },
  { name: 'Rizky Pratama', email: 'buyer2@batikwangi.id', password: 'Pembeli#12345', role: 'buyer', whatsapp: '6281234567894' },
];

const PRODUCTS = [
  {
    seller: 'seller1@batikwangi.id', category: 'Batik Tulis', name: 'Batik Tulis Gajah Oling Klasik',
    price: 485000, stock: 6, featured: 1, image: '/img/gajah-oling.svg',
    description: 'Kain batik tulis tangan motif ikonik Gajah Oling dengan pewarnaan soga alam. Ukuran 215 x 115 cm.',
  },
  {
    seller: 'seller2@batikwangi.id', category: 'Kebaya', name: 'Kebaya Kutubaru Osing Beludru',
    price: 375000, stock: 8, featured: 1, image: '/img/kebaya-osing.svg',
    description: 'Kebaya tradisional masyarakat suku Osing dengan potongan kutubaru elegan dan aksen bordir emas.',
  },
  {
    seller: 'seller1@batikwangi.id', category: 'Batik Cap', name: 'Batik Cap Paras Gempal Terakota',
    price: 195000, stock: 14, featured: 0, image: '/img/paras-gempal.svg',
    description: 'Motif Paras Gempal melambangkan keteguhan hati masyarakat Blambangan. Bahan primisima lembut.',
  },
  {
    seller: 'seller2@batikwangi.id', category: 'Kebaya', name: 'Kebaya Encim Gandrung Merah Marun',
    price: 420000, stock: 4, featured: 1, image: '/img/kebaya-gandrung.svg',
    description: 'Terinspirasi dari keanggunan penari Gandrung Banyuwangi dengan bordir kerancang halus.',
  },
  {
    seller: 'seller1@batikwangi.id', category: 'Batik Tulis', name: 'Batik Kangkung Setingkes Zamrud',
    price: 450000, stock: 5, featured: 0, image: '/img/kangkung-setingkes.svg',
    description: 'Filosofi ikatan kangkung menyatu melambangkan kerukunan dan persaudaraan warga Osing.',
  },
  {
    seller: 'seller2@batikwangi.id', category: 'Aksesoris & Bawahan', name: 'Selendang Batik Sekar Jagad Blambangan',
    price: 145000, stock: 18, featured: 0, image: '/img/sekar-jagad.svg',
    description: 'Selendang wastra serbaguna perpaduan ragam motif pesisir. Ukuran 200 x 55 cm.',
  },
  {
    seller: 'seller1@batikwangi.id', category: 'Batik Cap', name: 'Kain Batik Cap Kopi Pecah Kemiren',
    price: 215000, stock: 11, featured: 1, image: '/img/kopi-pecah.svg',
    description: 'Terinspirasi dari tradisi kopi Desa Adat Kemiren. Nuansa cokelat kopi panggang yang hangat.',
  },
  {
    seller: 'seller2@batikwangi.id', category: 'Aksesoris & Bawahan', name: 'Rok Lilit Batik Sembruk Cacing',
    price: 175000, stock: 0, featured: 0, image: '/img/sembruk-cacing.svg',
    description: 'Rok lilit instan motif klasik Sembruk Cacing dengan tali fleksibel all-size.',
  },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  if (RESET) {
    await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    console.log(`Database "${DB_NAME}" dihapus.`);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB_NAME}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);

  const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM users');
  if (Number(total) > 0) {
    console.log(`Data sudah ada (${total} user). Gunakan "npm run db:reset" untuk mengisi ulang.`);
    await conn.end();
    return;
  }

  for (const user of USERS) {
    const hash = await bcrypt.hash(user.password, 12);
    await conn.query(
      'INSERT INTO users (name, email, password_hash, role, whatsapp) VALUES (?, ?, ?, ?, ?)',
      [user.name, user.email, hash, user.role, user.whatsapp]
    );
  }
  const [userRows] = await conn.query('SELECT id, email FROM users');
  const userIdByEmail = new Map(userRows.map((u) => [u.email, u.id]));

  for (const category of CATEGORIES) {
    await conn.query('INSERT INTO categories (name, description) VALUES (?, ?)', [category.name, category.description]);
  }
  const [categoryRows] = await conn.query('SELECT id, name FROM categories');
  const categoryIdByName = new Map(categoryRows.map((c) => [c.name, c.id]));

  for (const product of PRODUCTS) {
    await conn.query(
      'INSERT INTO products (seller_id, category_id, name, description, price, stock, featured, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        userIdByEmail.get(product.seller),
        categoryIdByName.get(product.category),
        product.name,
        product.description,
        product.price,
        product.stock,
        product.featured,
        product.image,
      ]
    );
  }

  console.log('Seed selesai:');
  console.log(`  ${USERS.length} user  (admin/seller/buyer)`);
  console.log(`  ${CATEGORIES.length} kategori`);
  console.log(`  ${PRODUCTS.length} produk`);
  console.log('\nAkun demo (email / password):');
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(6)} ${u.email} / ${u.password}`));
  await conn.end();
}

main().catch((err) => {
  console.error('Seed gagal:', err.message);
  process.exit(1);
});
