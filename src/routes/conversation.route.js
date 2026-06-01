const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");
const {
  createConversation,
  listConversations,
  exploreGroups,
  getGroupExplorePreviewHandler,
  joinGroup,
  getConversationMembers,
  updateConversation,
  addMember,
  updateMemberRole,
  removeMember,
  leaveConversation,
  deleteConversation,
} = require("../controllers/conversation.controller");
const {
  searchConversationMessagesHandler,
  getConversationMessages,
  sendConversationMessageHandler,
  getChannelMessages,
  sendChannelMessageHandler,
} = require("../controllers/conversationMessage.controller");
const {
  listChannelsHandler,
  createChannelHandler,
  patchChannelHandler,
  deleteChannelHandler,
} = require("../controllers/channel.controller");

const { conversationInviteRouter } = require("./invite.route");

const router = express.Router();

router.get("/", protectRoute, listConversations);
router.get("/explore", protectRoute, exploreGroups);
router.get("/explore/:conversationId/preview", protectRoute, getGroupExplorePreviewHandler);
router.post("/", protectRoute, createConversation);
router.post("/:conversationId/join", protectRoute, joinGroup);
router.use("/:conversationId/invites", conversationInviteRouter);
router.patch("/:conversationId", protectRoute, updateConversation);
router.get("/:conversationId/members", protectRoute, getConversationMembers);
router.post("/:conversationId/members", protectRoute, addMember);
router.patch("/:conversationId/members/:userId", protectRoute, updateMemberRole);
router.delete("/:conversationId/members/:userId", protectRoute, removeMember);
router.post("/:conversationId/leave", protectRoute, leaveConversation);
router.delete("/:conversationId", protectRoute, deleteConversation);
router.get("/:conversationId/channels", protectRoute, listChannelsHandler);
router.post("/:conversationId/channels", protectRoute, createChannelHandler);
router.get("/:conversationId/channels/:channelId/messages", protectRoute, getChannelMessages);
router.post("/:conversationId/channels/:channelId/messages", protectRoute, sendChannelMessageHandler);
router.patch("/:conversationId/channels/:channelId", protectRoute, patchChannelHandler);
router.delete("/:conversationId/channels/:channelId", protectRoute, deleteChannelHandler);
router.get(
  "/:conversationId/messages/search",
  protectRoute,
  searchConversationMessagesHandler,
);
router.get("/:conversationId/messages", protectRoute, getConversationMessages);
router.post("/:conversationId/messages", protectRoute, sendConversationMessageHandler);

module.exports = router;

