# SPEC.md — BatikWangi (Katalog & Manajemen UMKM Batik & Kebaya Banyuwangi)

## 1. Tujuan (Objectives)
Membangun aplikasi web **BatikWangi** sebagai etalase digital dan sistem manajemen inventaris UMKM batik dan kebaya khas Banyuwangi. Sistem memiliki backend MySQL, autentikasi sesi, otorisasi berbasis peran, unggah gambar produk, dan tombol pemesanan langsung ke penjual melalui WhatsApp.

## 2. Peran Pengguna

| Peran | Hak Akses |
| --- | --- |
| **Admin** | Mengelola akun pengguna: tambah, ubah, aktif/nonaktif, hapus, mengatur role dan nomor WhatsApp. Melihat statistik platform. Tidak mengelola produk/kategori. |
| **Seller** | Mengelola produk miliknya (tambah, ubah, hapus, stok, status unggulan), mengunggah gambar produk, mengelola kategori, dan mengatur nomor WhatsApp toko. |
| **Pembeli** | Melihat katalog dan detail produk, mencari/memfilter, menghubungi penjual via WhatsApp, atau membeli melalui keranjang belanja dengan pembayaran transfer. Tidak memiliki akses tulis ke data produk. |
| **Publik (belum masuk)** | Dapat melihat katalog; pendaftaran mandiri dapat membuat akun pembeli atau penjual. Akun penjual baru menunggu konfirmasi admin sebelum aktif. |

## 3. Fitur Utama

### 3.1 Katalog Pembeli
- Pencarian real-time berdasarkan nama produk, deskripsi, atau nama penjual.
- Filter kategori, filter produk unggulan, filter stok tersedia, serta pengurutan harga/nama.
- Kartu produk menampilkan gambar, kategori, harga, stok, penjual, dan status unggulan.
- Detail produk dengan pemilihan jumlah (dibatasi stok) dan tombol `wa.me` yang membentuk pesan otomatis berisi nama produk, kategori, penjual, harga satuan, jumlah, dan estimasi total.
- Nomor WhatsApp tujuan berasal dari akun seller pemilik produk; produk seller nonaktif tidak ditampilkan.
- Pembeli dapat memilih mekanisme pembayaran: WhatsApp langsung atau keranjang belanja.
- Keranjang belanja mengumpulkan beberapa produk, menghitung total harga, dan membuat pesanan dengan pembayaran transfer.
- Pesanan transfer disimpan dengan status pembayaran; admin dapat memverifikasi dan mengubah status.

### 3.2 Manajemen Seller
- Dashboard berisi statistik produk, stok, produk unggulan, dan stok habis.
- CRUD produk dengan validasi harga, stok, kategori, dan deskripsi.
- Unggah gambar produk (JPG/PNG/WEBP/GIF, maks. 3 MB); gambar lama otomatis dihapus saat diganti atau produk dihapus.
- Pengaturan stok cepat (+/−) dan toggle status unggulan.
- CRUD kategori; kategori yang masih dipakai produk tidak dapat dihapus.
- Pengaturan nama dan nomor WhatsApp toko.

### 3.3 Manajemen Admin
- Daftar pengguna dengan pencarian dan filter role.
- Tambah user dengan role admin/seller/pembeli, serta konfirmasi (aktivasi) akun penjual yang mendaftar mandiri.
- Ubah data user, reset kata sandi, aktif/nonaktifkan akun.
- Hapus user (produk dan gambar milik seller ikut terhapus).
- Proteksi: admin tidak dapat menghapus/menonaktifkan/menurunkan role akun sendiri, dan sistem selalu menyisakan minimal satu admin aktif.
- Statistik: jumlah user per role, user nonaktif, produk, stok, kategori, dan produk unggulan.

## 4. Arsitektur Teknis
- **Backend:** Node.js 20+, Express 4.
- **Database:** MySQL 8 (`users`, `categories`, `products`, `sessions`).
- **Autentikasi:** express-session dengan penyimpanan sesi di MySQL; password bcrypt (cost 12).
- **Upload:** multer, penyimpanan lokal `uploads/`, nama file acak, validasi MIME & ukuran.
- **Frontend:** SPA vanilla JavaScript + Tailwind CSS hasil build lokal + Lucide (aset lokal).
- **Keamanan:** Helmet CSP, rate limit login/registrasi, prepared statement, escape HTML di sisi klien, validasi input di server, cookie `httpOnly`/`sameSite=lax` (dan `secure` saat production).

## 5. Model Data
- `users`: id, name, email (unik), password_hash, role (`admin`/`seller`/`buyer`), whatsapp, active, timestamps.
- `categories`: id, name (unik), description, timestamps.
- `products`: id, seller_id (FK users), category_id (FK categories), name, description, price, stock, featured, image_url, timestamps.
- `sessions`: tabel sesi yang dibuat otomatis oleh session store MySQL.

## 6. API Ringkas
- `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile`
- `GET /api/products`, `GET /api/products/:id`
- `GET|POST|PUT|DELETE /api/products/seller...` (seller)
- `GET /api/categories` (publik), `POST|PUT|DELETE /api/categories` (seller)
- `GET|POST|PUT|DELETE /api/admin/users`, `GET /api/admin/stats` (admin)

## 7. Data Dummy
Seeder menyediakan 1 admin, 2 seller, 2 pembeli, 4 kategori, dan 8 produk dengan gambar motif lokal. Kredensial demo tercantum di `README.md`.

## 8. Kriteria Penerimaan
1. Setiap peran hanya dapat melakukan aksi sesuai tabel hak akses; akses tidak sah ditolak server (401/403).
2. Seller hanya dapat mengubah produk miliknya sendiri.
3. Gambar produk dapat diunggah, ditampilkan, diganti, dan dibersihkan saat produk dihapus.
4. Tombol WhatsApp membuka nomor seller yang benar dengan format pesan otomatis.
5. Katalog menampilkan produk seller aktif beserta filter dan pencarian yang berfungsi.
6. Admin dapat mengelola user tanpa dapat mengunci dirinya sendiri atau menghapus admin terakhir.
7. Data tersimpan permanen di MySQL dan sesi tetap valid setelah restart server.
