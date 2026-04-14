const multer = require("multer");

const storage = multer.memoryStorage(); // dùng RAM để upload lên cloud

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = upload;