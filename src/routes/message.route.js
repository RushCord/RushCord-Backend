const express = require("express");
const { getUsersForSideBar, sendMessage , recallMessage, forwardMessage} = require("../controllers/message.controller");
const { protectRoute } = require("../middleware/auth.middleware");
const { getMessages } = require("../controllers/message.controller");
const upload = require("../middleware/upload");
const router = express.Router();

router.get("/users",protectRoute, getUsersForSideBar)
router.get("/:id",protectRoute, getMessages)
router.put("/recall/:id", protectRoute, recallMessage);
router.post(
  "/send/:id",
  protectRoute,
  upload.single("file"), // 🔥 QUAN TRỌNG
  sendMessage
);
router.post("/forward", protectRoute, forwardMessage);

module.exports = router;

