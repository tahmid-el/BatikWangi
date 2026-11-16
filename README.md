# BatikWangi

Etalase digital dan manajemen inventaris UMKM batik & kebaya khas Banyuwangi.
Aplikasi production-ready dengan Node.js + Express, database MySQL, sesi tersimpan di MySQL, dan tiga peran pengguna: **admin**, **seller**, dan **pembeli**.

## Fitur

| Peran | Kemampuan |
| --- | --- |
| **Admin** | Mengelola user (tambah, ubah, aktif/nonaktif, hapus), mengatur role dan nomor WhatsApp, melihat statistik platform |
| **Seller** | CRUD produk miliknya, upload/ganti gambar produk, CRUD kategori, atur stok, tandai produk unggulan, mengatur nomor WhatsApp toko |
| **Pembeli** | Melihat katalog, mencari/filter produk, melihat detail, menghubungi penjual lewat WhatsApp, atau membeli lewat keranjang belanja dengan pembayaran transfer |
| **Publik** | Katalog dan detail produk dapat dilihat tanpa masuk; pendaftaran mandiri untuk pembeli atau penjual. Akun penjual baru menunggu konfirmasi admin |

## Prasyarat

- Node.js 20+
- MySQL 8+

## Menjalankan

```bash
npm install
cp .env.example .env        # sesuaikan kredensial MySQL & SESSION_SECRET
npm run db:seed             # buat database, tabel, dan data dummy
npm start                   # http://localhost:3000
```

Development dengan reload otomatis: `npm run dev`.

Bila `public/index.html` atau `public/app.js` diubah dan ada kelas Tailwind baru:

```bash
npm run css:build
```

## Akun demo

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@batikwangi.id` | `Admin#12345` |
| Seller | `seller1@batikwangi.id` | `Seller#12345` |
| Seller | `seller2@batikwangi.id` | `Seller#12345` |
| Pembeli | `buyer1@batikwangi.id` | `Pembeli#12345` |
| Pembeli | `buyer2@batikwangi.id` | `Pembeli#12345` |

Data dummy mencakup 4 kategori dan 8 produk (gambar motif SVG lokal di `public/img/`).

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm start` | Menjalankan server produksi/development |
| `npm run dev` | Menjalankan server dengan watch mode |
| `npm run db:seed` | Membuat tabel dan mengisi data bila database masih kosong |
| `npm run db:reset` | Menghapus database lalu mengisi ulang data dummy |
| `npm run css:build` | Build ulang `public/assets/app.css` dari kelas Tailwind yang dipakai |
| `npm run assets` | Salin ulang Lucide ke `public/vendor/` |

## Struktur

```
database/          schema.sql + seeder data dummy
src/
  server.js        bootstrap Express, sesi MySQL, CSP, static, fallback SPA
  db.js            connection pool MySQL
  auth.js          middleware sesi & otorisasi role
  upload.js        konfigurasi multer + validasi & pembersihan gambar
  routes/          auth, categories, products, admin
public/            SPA (index.html, app.js) + aset lokal
uploads/           gambar produk hasil unggahan
```

## Keamanan & operasional

- Password di-hash dengan bcrypt (cost 12); sesi disimpan di tabel `sessions` MySQL, cookie `httpOnly` + `sameSite=lax`.
- Otorisasi diperiksa di server untuk setiap aksi; seller hanya bisa mengubah produknya sendiri.
- Upload dibatasi JPG/PNG/WEBP/GIF maksimum 3 MB (`UPLOAD_MAX_BYTES`), nama file diacak, dan file lama dibersihkan saat diganti/dihapus.
- Helmet CSP aktif; aset frontend (Tailwind hasil build, Lucide) dilayani lokal.
- Rate limit untuk login (20/15 menit) dan pendaftaran (10/jam) per IP.
- Semua query memakai prepared statement; input divalidasi di server.

Untuk produksi: set `NODE_ENV=production`, isi `SESSION_SECRET` acak yang panjang, gunakan user MySQL khusus (bukan root), layani di belakang HTTPS/reverse proxy, batasi akses ke folder `uploads/`, dan backup database secara berkala.
