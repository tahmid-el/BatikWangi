'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const maxBytes = Number(process.env.UPLOAD_MAX_BYTES || 3 * 1024 * 1024);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      const err = new Error('Format gambar harus JPG, PNG, WEBP, atau GIF.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

/** Hapus file unggahan lama; abaikan jika bukan file upload atau sudah tidak ada. */
function removeUploadedImage(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return;
  const filename = path.basename(imageUrl);
  fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
}

function uploadErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Ukuran gambar maksimal ${Math.round(maxBytes / (1024 * 1024))} MB.`
        : 'Berkas gambar tidak valid.';
    return res.status(400).json({ error: message });
  }
  if (err && err.status === 400) return res.status(400).json({ error: err.message });
  next(err);
}

module.exports = { upload, removeUploadedImage, uploadErrorHandler, maxBytes };
