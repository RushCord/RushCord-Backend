const express = require("express");
const {
  getUsersForSideBar,
  sendMessage,
  recallMessage,
  recallMessageMe,
  forwardMessage,
} = require("../controllers/message.controller");
const { protectRoute } = require("../middleware/auth.middleware");
const { getMessages } = require("../controllers/message.controller");
const router = express.Router();

router.get("/users", protectRoute, getUsersForSideBar);
router.get("/:id", protectRoute, getMessages);
router.put("/recall/:id", protectRoute, recallMessage);
router.put("/recall-me/:id", protectRoute, recallMessageMe);
router.post("/send/:id", protectRoute, sendMessage);
router.post("/forward", protectRoute, forwardMessage);

module.exports = router;

