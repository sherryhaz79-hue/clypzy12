
// // backend/src/middleware/upload.js
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');

// // Ensure upload directory exists
// const uploadDir = 'uploads/logos';
// if (!fs.existsSync(uploadDir)) {
//      fs.mkdirSync(uploadDir, { recursive: true });
// }

// const storage = multer.diskStorage({
//      destination: (req, file, cb) => {
//           cb(null, uploadDir);
//      },
//      filename: (req, file, cb) => {
//           // Senior tip: Use unique filenames to prevent overwriting
//           const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//           cb(null, `brand-${uniqueSuffix}${path.extname(file.originalname)}`);
//      }
// });

// const fileFilter = (req, _file, cb) => {
//      if (!_file.originalname.match(/\.(jpg|jpeg|png|webp)$/)) {
//           return cb(new Error('Only image files (jpg, png, webp) are allowed!'), false);
//      }
//      cb(null, true);
// };


// const upload = multer({
//      storage: storage,
//      fileFilter: fileFilter,
//      limits: {
//           fileSize: 2 * 1024 * 1024 // 2MB Limit
//      }
// });

// module.exports = upload;

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const hasCloudinaryCreds = Boolean(
  process.env.CLOUD_NAME && process.env.CLOUD_API_KEY && process.env.CLOUD_API_SECRET
);

const requestedStorage = (process.env.UPLOAD_STORAGE || 'local').toLowerCase();
const useCloudinary = requestedStorage === 'cloudinary' && hasCloudinaryCreds;

let storage;

if (useCloudinary) {
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  const cloudinary = require('../config/cloudinary');

  storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'diro-logos',
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
  });
} else {
  const uploadDir = path.join(process.cwd(), 'uploads', 'logos');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `brand-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  });
}

const fileFilter = (_req, file, cb) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
    return cb(new Error('Only image files (jpg, png, webp) are allowed'), false);
  }
  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
});

module.exports = upload;
