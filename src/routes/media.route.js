const express = require("express");
const { presignedUpload } = require("../controllers/media.controller");
const { protectRoute } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/presigned-upload", protectRoute, presignedUpload);

module.exports = router;
