const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");
const {
  getFriends,
  getFriendRequests,
  postFriendRequest,
  acceptRequest,
  deleteRequest,
  deleteFriend,
} = require("../controllers/friend.controller");

const router = express.Router();

router.get("/", protectRoute, getFriends);
router.get("/requests", protectRoute, getFriendRequests);
router.post("/requests", protectRoute, postFriendRequest);
router.post("/requests/:otherUserId/accept", protectRoute, acceptRequest);
router.delete("/requests/:otherUserId", protectRoute, deleteRequest);
router.delete("/:otherUserId", protectRoute, deleteFriend);

module.exports = router;
