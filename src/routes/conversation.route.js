const express = require("express");
const { protectRoute } = require("../middleware/auth.middleware");
const {
  createConversation,
  listConversations,
  getConversationMembers,
  updateConversation,
  addMember,
  updateMemberRole,
  removeMember,
  leaveConversation,
  deleteConversation,
} = require("../controllers/conversation.controller");
const {
  getConversationMessages,
  sendConversationMessageHandler,
} = require("../controllers/conversationMessage.controller");

const router = express.Router();

router.get("/", protectRoute, listConversations);
router.post("/", protectRoute, createConversation);
router.patch("/:conversationId", protectRoute, updateConversation);
router.get("/:conversationId/members", protectRoute, getConversationMembers);
router.post("/:conversationId/members", protectRoute, addMember);
router.patch("/:conversationId/members/:userId", protectRoute, updateMemberRole);
router.delete("/:conversationId/members/:userId", protectRoute, removeMember);
router.post("/:conversationId/leave", protectRoute, leaveConversation);
router.delete("/:conversationId", protectRoute, deleteConversation);
router.get("/:conversationId/messages", protectRoute, getConversationMessages);
router.post("/:conversationId/messages", protectRoute, sendConversationMessageHandler);

module.exports = router;

