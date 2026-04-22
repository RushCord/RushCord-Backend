const {
  createGroupConversation,
  listUserConversations,
  listConversationMembers,
  updateGroupConversationMeta,
  updateConversationMemberRole,
  removeConversationMember,
  addConversationMember,
  dissolveGroupConversation,
} = require("../services/conversationsService");
const {
  assertUserInConversation,
  getConversationMember,
} = require("../services/conversationService");
const { sendConversationMessage } = require("../services/messageService");
const { io } = require("../lib/socket");

const createConversation = async (req, res) => {
  try {
    const creatorId = req.user._id;
    const { title, memberIds } = req.body ?? {};
    const meta = await createGroupConversation({
      creatorId,
      title,
      memberIds,
    });
    return res.status(201).json({
      conversationId: meta.conversationId,
      type: meta.type,
      title: meta.title,
      avatar: meta.avatar || "",
      createdAt: meta.createdAt,
      createdBy: meta.createdBy,
      memberCount: meta.memberCount,
    });
  } catch (e) {
    if (e.code === "INVALID_TITLE") {
      return res.status(400).json({ error: "Invalid title" });
    }
    if (e.code === "INVALID_MEMBERS") {
      return res.status(400).json({ error: "Invalid members" });
    }
    if (e.code === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "User not found", missingUserIds: e.missingUserIds || [] });
    }
    console.error("createConversation error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const listConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = req.query?.limit;
    const items = await listUserConversations({ userId, limit });
    return res.status(200).json(items);
  } catch (e) {
    console.error("listConversations error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getConversationMembers = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    await assertUserInConversation({ conversationId, userId });
    const items = await listConversationMembers(conversationId);
    // public-ish shape
    const out = items.map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
      role: m.role,
      joinedAt: m.joinedAt,
      status: m.status,
    }));
    return res.status(200).json(out);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    console.error("getConversationMembers error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const member = await assertUserInConversation({ conversationId, userId });
    if (member.role !== "OWNER") {
      return res.status(403).json({ error: "Only owner can update group" });
    }

    const { title, avatar, avatarUrl } = req.body ?? {};
    const meta = await updateGroupConversationMeta({
      conversationId,
      title,
      avatar: avatar !== undefined ? avatar : avatarUrl,
    });

    return res.status(200).json({
      conversationId: meta.conversationId,
      type: meta.type,
      title: meta.title,
      avatar: meta.avatar || "",
      createdAt: meta.createdAt,
      createdBy: meta.createdBy,
      memberCount: meta.memberCount,
      updatedAt: meta.updatedAt,
    });
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    if (e.code === "INVALID_TITLE") {
      return res.status(400).json({ error: "Invalid title" });
    }
    if (e.code === "CONVERSATION_NOT_FOUND") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (e.code === "NOT_A_GROUP") {
      return res.status(400).json({ error: "Not a group conversation" });
    }
    console.error("updateConversation error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createConversation,
  listConversations,
  getConversationMembers,
  updateConversation,
  leaveConversation: async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user._id;

      const member = await assertUserInConversation({ conversationId, userId });
      if (String(member.role || "").toUpperCase() === "OWNER") {
        return res.status(400).json({ error: "Owner cannot leave group", code: "OWNER_CANNOT_LEAVE" });
      }

      const out = await removeConversationMember({ conversationId, userId });

      // System notice
      try {
        const actorName = req.user?.fullName || "Someone";
        const msg = await sendConversationMessage({
          conversationId,
          senderId: userId,
          text: `${actorName} đã rời nhóm`,
          conversationType: "GROUP",
          isSystem: true,
        });
        io.to(conversationId).emit("newMessage", msg);
      } catch {
        // best effort
      }

      return res.status(200).json(out);
    } catch (e) {
      if (e.code === "NOT_IN_CONVERSATION") {
        return res.status(403).json({ error: "Not in conversation" });
      }
      if (e.code === "CONVERSATION_NOT_ACCEPTED") {
        return res.status(403).json({ error: "Conversation not accepted" });
      }
      console.error("leaveConversation error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
  deleteConversation: async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user._id;

      const member = await assertUserInConversation({ conversationId, userId });
      if (String(member.role || "").toUpperCase() !== "OWNER") {
        return res.status(403).json({ error: "Only owner can dissolve group" });
      }

      const out = await dissolveGroupConversation({ conversationId });

      // Best-effort system message before room disappears. (Room may still exist client-side)
      try {
        const actorName = req.user?.fullName || "Someone";
        const msg = await sendConversationMessage({
          conversationId,
          senderId: userId,
          text: `${actorName} đã giải tán nhóm`,
          conversationType: "GROUP",
          isSystem: true,
        });
        io.to(conversationId).emit("newMessage", msg);
      } catch {
        // ignore
      }

      return res.status(200).json(out);
    } catch (e) {
      if (e.code === "NOT_IN_CONVERSATION") {
        return res.status(403).json({ error: "Not in conversation" });
      }
      if (e.code === "CONVERSATION_NOT_ACCEPTED") {
        return res.status(403).json({ error: "Conversation not accepted" });
      }
      if (e.code === "CONVERSATION_NOT_FOUND") {
        return res.status(404).json({ error: "Conversation not found" });
      }
      if (e.code === "NOT_A_GROUP") {
        return res.status(400).json({ error: "Not a group conversation" });
      }
      console.error("deleteConversation error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
  updateMemberRole: async (req, res) => {
    try {
      const { conversationId, userId: targetUserId } = req.params;
      const actorId = req.user._id;
      const bodyRole = req.body?.role;

      const actor = await assertUserInConversation({ conversationId, userId: actorId });
      const target = await getConversationMember({ conversationId, userId: targetUserId });
      if (!target) return res.status(404).json({ error: "Member not found" });

      if (target.role === "OWNER") {
        return res.status(400).json({ error: "Cannot change owner role" });
      }

      const nextRole = String(bodyRole || "").trim().toUpperCase();
      if (nextRole !== "MEMBER" && nextRole !== "ADMIN") {
        return res.status(400).json({ error: "Invalid role" });
      }

      // Permission rules:
      // - OWNER can set MEMBER<->ADMIN.
      // - ADMIN can promote MEMBER->ADMIN only (cannot demote ADMIN->MEMBER).
      if (actor.role === "OWNER") {
        // ok
      } else if (actor.role === "ADMIN") {
        if (target.role !== "MEMBER" || nextRole !== "ADMIN") {
          return res.status(403).json({ error: "Not allowed" });
        }
      } else {
        return res.status(403).json({ error: "Not allowed" });
      }

      const out = await updateConversationMemberRole({
        conversationId,
        userId: targetUserId,
        nextRole,
      });

      // System notice in chat
      try {
        const actorName = req.user?.fullName || "Someone";
        const targetName = target.fullName || targetUserId;
        const msg = await sendConversationMessage({
          conversationId,
          senderId: actorId,
          text: `${actorName} đã cấp quyền ${nextRole} cho ${targetName}`,
          conversationType: "GROUP",
          isSystem: true,
        });
        io.to(conversationId).emit("newMessage", msg);
      } catch {
        // best effort
      }

      return res.status(200).json(out);
    } catch (e) {
      if (e.code === "NOT_IN_CONVERSATION") {
        return res.status(403).json({ error: "Not in conversation" });
      }
      if (e.code === "CONVERSATION_NOT_ACCEPTED") {
        return res.status(403).json({ error: "Conversation not accepted" });
      }
      if (e.code === "INVALID_ROLE") {
        return res.status(400).json({ error: "Invalid role" });
      }
      console.error("updateMemberRole error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
  removeMember: async (req, res) => {
    try {
      const { conversationId, userId: targetUserId } = req.params;
      const actorId = req.user._id;

      const actor = await assertUserInConversation({ conversationId, userId: actorId });
      const target = await getConversationMember({ conversationId, userId: targetUserId });
      if (!target) return res.status(404).json({ error: "Member not found" });

      if (target.role === "OWNER") {
        return res.status(400).json({ error: "Cannot remove owner" });
      }

      // Permission rules:
      // - OWNER can remove ADMIN/MEMBER
      // - ADMIN can remove MEMBER only
      if (actor.role === "OWNER") {
        // ok
      } else if (actor.role === "ADMIN") {
        if (target.role !== "MEMBER") return res.status(403).json({ error: "Not allowed" });
      } else {
        return res.status(403).json({ error: "Not allowed" });
      }

      const out = await removeConversationMember({ conversationId, userId: targetUserId });

      // System notice in chat
      try {
        const actorName = req.user?.fullName || "Someone";
        const targetName = target.fullName || targetUserId;
        const msg = await sendConversationMessage({
          conversationId,
          senderId: actorId,
          text: `${actorName} đã xóa ${targetName} khỏi nhóm`,
          conversationType: "GROUP",
          isSystem: true,
        });
        io.to(conversationId).emit("newMessage", msg);
      } catch {
        // best effort
      }

      return res.status(200).json(out);
    } catch (e) {
      if (e.code === "NOT_IN_CONVERSATION") {
        return res.status(403).json({ error: "Not in conversation" });
      }
      if (e.code === "CONVERSATION_NOT_ACCEPTED") {
        return res.status(403).json({ error: "Conversation not accepted" });
      }
      console.error("removeMember error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
  addMember: async (req, res) => {
    try {
      const { conversationId } = req.params;
      const actorId = req.user._id;
      const newUserId = req.body?.userId;
      if (!newUserId) return res.status(400).json({ error: "userId is required" });

      const actor = await assertUserInConversation({ conversationId, userId: actorId });
      if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
        return res.status(403).json({ error: "Not allowed" });
      }

      const out = await addConversationMember({
        conversationId,
        userId: String(newUserId),
      });

      // System notice in chat
      try {
        const actorName = req.user?.fullName || "Someone";
        const targetName = out?.fullName || String(newUserId);
        const msg = await sendConversationMessage({
          conversationId,
          senderId: actorId,
          text: `${actorName} đã thêm ${targetName} vào nhóm`,
          conversationType: "GROUP",
          isSystem: true,
        });
        io.to(conversationId).emit("newMessage", msg);
      } catch {
        // best effort
      }

      return res.status(201).json(out);
    } catch (e) {
      if (e.code === "NOT_IN_CONVERSATION") {
        return res.status(403).json({ error: "Not in conversation" });
      }
      if (e.code === "CONVERSATION_NOT_ACCEPTED") {
        return res.status(403).json({ error: "Conversation not accepted" });
      }
      if (e.code === "USER_NOT_FOUND") {
        return res.status(404).json({ error: "User not found" });
      }
      if (e.code === "CONVERSATION_NOT_FOUND") {
        return res.status(404).json({ error: "Conversation not found" });
      }
      if (e.code === "NOT_A_GROUP") {
        return res.status(400).json({ error: "Not a group conversation" });
      }
      console.error("addMember error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

