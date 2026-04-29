import multer from 'multer';

// Memory storage: file lives in req.file.buffer - no temp files on disk.
// Keep limits tight; bulk imports for thousands of students still fit in 5 MB.
const ACCEPTED_EXT = /\.(csv|xlsx|xls)$/i;
const ACCEPTED_MIME = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream' // some clients send this
]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1
  },
  fileFilter(_req, file, cb) {
    if (ACCEPTED_EXT.test(file.originalname) || ACCEPTED_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only .csv / .xlsx / .xls files are accepted'));
  }
});
