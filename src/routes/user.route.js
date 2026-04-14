const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");
const { searchUsers, getUserPublic } = require("../controllers/user.controller");

const router = express.Router();

router.get("/search", protectRoute, searchUsers);
router.get("/:userId", protectRoute, getUserPublic);

module.exports = router;
