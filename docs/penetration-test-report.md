# Laporan Uji Penetrasi – BatikWangi

Tanggal pengujian: 16 November 2026  
Cakupan: aplikasi web BatikWangi (Node.js/Express, MySQL, frontend vanilla JS)  
Metode: tinjauan kode sumber, pengujian API dengan `curl`, dan verifikasi kontrol akses, validasi input, autentikasi, sesi, unggah berkas, serta dependensi.

## 1. Ringkasan

Aplikasi memiliki fondasi keamanan yang cukup baik: Helmet, sesi MySQL, cookie `HttpOnly`, bcrypt cost 12, query berparameter, validasi input, pembatasan laju login/pendaftaran, dan kontrol peran. Pengujian menemukan beberapa temuan, terutama pada dependensi rentan, pembatasan laju API, dan potensi penyalahgunaan checkout. Temuan yang dapat diperbaiki langsung telah ditangani pada commit terbaru.

## 2. Lingkungan Uji

- URL lokal: `http://localhost:3000`
- Akun uji: admin, seller, buyer (akun demo dari seed)
- Database: MySQL 8+
- Browser/API client: `curl`, inspeksi sumber

## 3. Metodologi

Pengujian mengacu pada OWASP Top 10 (2021):

1. A01 Broken Access Control
2. A02 Cryptographic Failures
3. A03 Injection
4. A04 Insecure Design
5. A05 Security Misconfiguration
6. A06 Vulnerable and Outdated Components
7. A07 Identification and Authentication Failures
8. A08 Software and Data Integrity Failures
9. A09 Security Logging and Monitoring Failures
10. A10 Server-Side Request Forgery (SSRF)

## 4. Hasil Pengujian per Kategori OWASP

| Kategori | Status | Catatan |
|---|---|---|
| A01 Broken Access Control | Sebagian diperbaiki | Kontrol peran sudah ada; seller tidak dapat mengakses endpoint admin atau checkout. Kategori bersama dapat diubah seller mana pun. |
| A02 Cryptographic Failures | Baik | bcrypt cost 12, cookie HttpOnly/SameSite, secret produksi wajib. |
| A03 Injection | Baik | Query berparameter; `ORDER BY` menggunakan whitelist. |
| A04 Insecure Design | Diperbaiki | Checkout transfer memakai harga dari database; stok dikunci dengan `FOR UPDATE`. |
| A05 Security Misconfiguration | Diperbaiki | Helmet aktif; rate limit global API ditambahkan. |
| A06 Vulnerable Components | Diperbaiki | `mysql2` dinaikkan ke 3.24.6 melalui override; audit 0 kerentanan. |
| A07 Auth Failures | Baik | Rate limit login/register, regenerasi sesi, logout. |
| A08 Data Integrity | Baik | Upload membatasi MIME/ukuran; ekstensi diturunkan dari MIME. |
| A09 Logging/Monitoring | Diperbaiki sebagian | Pencatatan percobaan login gagal ditambahkan. |
| A10 SSRF | Tidak berlaku | Tidak ada pengambilan URL sisi server. |

## 5. Temuan dan Remediasi

### PT-01: Dependensi `mysql2` rentan (High)

- OWASP: A06
- Deskripsi: versi `mysql2` bawaan `express-mysql-session` (3.10.2) memiliki kerentanan high/moderate.
- Bukti: `npm audit` melaporkan 2 kerentanan.
- Remediasi: menaikkan `mysql2` ke `^3.24.6` dan menambahkan override npm.
- Status: Diperbaiki. `npm audit` kini 0 kerentanan.

### PT-02: Tidak ada pembatasan laju global pada API (Medium)

- OWASP: A05/A04
- Deskripsi: endpoint selain login/register tidak memiliki rate limiting, berpotensi penyalahgunaan/DoS.
- Remediasi: menambahkan `apiLimiter` (300 permintaan/15 menit/IP) pada `/api`.
- Status: Diperbaiki.

### PT-03: Penjual dapat melakukan pembelian/checkout (Medium)

- OWASP: A01
- Deskripsi: sebelum perbaikan, penjual dapat menambahkan produk ke keranjang dan membuat pesanan.
- Bukti: `POST /api/orders` sebelumnya tidak membatasi peran.
- Remediasi: backend menolak non-pembeli; frontend menyembunyikan kontrol pembelian untuk seller/admin.
- Status: Diperbaiki.

### PT-04: Pencatatan keamanan minimal (Low)

- OWASP: A09
- Deskripsi: percobaan login gagal tidak dicatat.
- Remediasi: menambahkan `console.warn` untuk percobaan login gagal.
- Status: Diperbaiki (dasar).

### PT-05: Enumerasi email pada pendaftaran (Low)

- OWASP: A07
- Deskripsi: endpoint register mengembalikan pesan “Email sudah terdaftar”, memungkinkan enumerasi akun.
- Dampak: informasi keberadaan akun bocor.
- Remediasi yang disarankan: gunakan pesan generik atau verifikasi email. Belum diubah agar UX tetap jelas.
- Status: Risiko residual (diterima).

### PT-06: Kategori bersama dapat diubah oleh seller mana pun (Low)

- OWASP: A01
- Deskripsi: semua seller dapat membuat, mengubah, dan menghapus kategori global.
- Dampak: perubahan data lintas pengguna.
- Remediasi yang disarankan: batasi pengelolaan kategori ke admin, atau tambahkan kepemilikan kategori.
- Status: Risiko residual (sesuai spesifikasi saat ini).

### PT-07: Validasi berkas unggahan hanya berbasis MIME (Low)

- OWASP: A08
- Deskripsi: fileFilter memeriksa `mimetype` dari klien; tidak ada pemeriksaan magic number.
- Mitigasi existing: ekstensi diturunkan dari MIME dan file disajikan sebagai gambar statis.
- Remediasi yang disarankan: validasi signature file setelah unggah atau gunakan library `file-type`.
- Status: Risiko residual (diterima).

### PT-08: Checkout tamu memungkinkan pemesanan tanpa akun (Info)

- OWASP: A04
- Deskripsi: pengguna anonim dapat membuat pesanan transfer.
- Dampak: spam pesanan/pengurangan stok.
- Mitigasi: rate limit checkout (30 pesanan/jam/IP) dan validasi stok dengan transaksi.
- Status: Sebagian dimitigasi.

## 6. Pengujian Ulang

- `npm audit`: 0 kerentanan.
- `node --check` seluruh file server/route/frontend: lolos.
- Akses admin oleh seller: `403`.
- Checkout oleh seller: `403`.
- SQL injection pada pencarian produk: tidak mengembalikan data tak terduga (hasil kosong).
- API health: `200 OK`.

## 7. Rekomendasi Lanjutan

1. Tambahkan CAPTCHA pada login/register bila aplikasi dipublikasikan.
2. Implementasikan audit log persisten untuk aksi admin.
3. Tambahkan verifikasi email dan reset password.
4. Validasi magic number untuk unggahan gambar.
5. Pertimbangkan pembatasan checkout untuk pengguna terautentikasi saja jika model bisnis menghendaki.
