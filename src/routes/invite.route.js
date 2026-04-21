const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");
const {
  getInvitePreviewHandler,
  acceptInviteHandler,
  listInvitesHandler,
  createInviteHandler,
  revokeInviteHandler,
} = require("../controllers/invite.controller");

const router = express.Router();

router.get("/:code/preview", getInvitePreviewHandler);
router.post("/:code/join", protectRoute, acceptInviteHandler);

const conversationInviteRouter = express.Router({ mergeParams: true });
conversationInviteRouter.get("/", protectRoute, listInvitesHandler);
conversationInviteRouter.post("/", protectRoute, createInviteHandler);
conversationInviteRouter.delete("/:inviteId", protectRoute, revokeInviteHandler);

module.exports = router;
module.exports.conversationInviteRouter = conversationInviteRouter;
