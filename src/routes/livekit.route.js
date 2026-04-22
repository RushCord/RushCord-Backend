const express = require("express");
const { authenticateAccessToken } = require("../middleware/auth.middleware");
const { mintToken } = require("../controllers/livekit.controller");

const router = express.Router();

router.post("/token", authenticateAccessToken, mintToken);

module.exports = router;

