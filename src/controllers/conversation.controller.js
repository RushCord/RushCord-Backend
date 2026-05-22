const {
  createGroupConversation,
  listUserConversations,
  listConversationMembers,
  updateGroupConversationMeta,
  updateConversationMemberRole,
  removeConversationMember,
  leaveGroupAsOwner,
  addConversationMember,
  searchGroupsForExplore,
  getGroupExplorePreview,
  joinGroupConversation,
  dissolveGroupConversation,
} = require("../services/conversationsService");
const {
  assertUserInConversation,
  getConversationMember,
} = require("../services/conversationService");
const { sendConversationMessage } = require("../services/messageService");
const { emitGroupNewMessage } = require("./conversationMessage.controller");

const createConversation = async (req, res) => {
  try {
    const creatorId = req.user._id;
    const { title, memberIds, topic, description, avatar, cover, coverPic } =
      req.body ?? {};
    const meta = await createGroupConversation({
      creatorId,
      title,
      memberIds,
      topic,
      description,
      avatar,
      cover: cover !== undefined ? cover : coverPic,
    });
    return res.status(201).json({
      conversationId: meta.conversationId,
      type: meta.type,
      title: meta.title,
      topic: meta.topic || "",
      description: meta.description || "",
      avatar: meta.avatar || "",
      cover: meta.cover || "",
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
    if (e.code === "INVALID_TOPIC") {
      return res.status(400).json({ error: "Invalid topic" });
    }
    if (e.code === "INVALID_DESCRIPTION") {
      return res.status(400).json({ error: "Description too long" });
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

const exploreGroups = async (req, res) => {
  try {
    const userId = req.user._id;
    const q = req.query?.q;
    const topic = req.query?.topic;
    const limit = req.query?.limit;
    const items = await searchGroupsForExplore(userId, q, topic, limit);
    return res.status(200).json(items);
  } catch (e) {
    if (e.code === "INVALID_TOPIC") {
      return res.status(400).json({ error: "Invalid topic" });
    }
    console.error("exploreGroups error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getGroupExplorePreviewHandler = async (req, res) => {
  try {
    const userId = req.user._id;
    const { conversationId } = req.params;
    const preview = await getGroupExplorePreview(userId, conversationId);
    return res.status(200).json(preview);
  } catch (e) {
    if (e.code === "CONVERSATION_NOT_FOUND") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (e.code === "NOT_A_GROUP") {
      return res.status(400).json({ error: "Not a group conversation" });
    }
    if (e.code === "GROUP_NOT_DISCOVERABLE") {
      return res.status(403).json({ error: "Group is not discoverable" });
    }
    console.error("getGroupExplorePreview error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const joinGroup = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    const out = await joinGroupConversation({ conversationId, userId });

    if (!out.alreadyMember) {
      try {
        const actorName = req.user?.fullName || "Someone";
        const msg = await sendConversationMessage({
          conversationId,
          senderId: userId,
          text: `${actorName} đã tham gia nhóm`,
          conversationType: "GROUP",
          isSystem: true,
        });
        emitGroupNewMessage(conversationId, msg);
      } catch {
        // best effort
      }
    }

    return res.status(out.alreadyMember ? 200 : 201).json(out);
  } catch (e) {
    if (e.code === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "User not found" });
    }
    if (e.code === "CONVERSATION_NOT_FOUND") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (e.code === "NOT_A_GROUP") {
      return res.status(400).json({ error: "Not a group conversation" });
    }
    if (e.code === "INVITE_ONLY_GROUP") {
      return res.status(403).json({
        error: "This group only accepts members via invite link",
      });
    }
    console.error("joinGroup error:", e);
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
      adminGrantedAt: m.adminGrantedAt || null,
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

    const { title, avatar, avatarUrl, cover, coverPic, joinPolicy } = req.body ?? {};
    const meta = await updateGroupConversationMeta({
      conversationId,
      title,
      avatar: avatar !== undefined ? avatar : avatarUrl,
      cover: cover !== undefined ? cover : coverPic,
      joinPolicy,
    });

    return res.status(200).json({
      conversationId: meta.conversationId,
      type: meta.type,
      title: meta.title,
      avatar: meta.avatar || "",
      cover: meta.cover || "",
      joinPolicy: meta.joinPolicy || "OPEN",
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
  exploreGroups,
  getGroupExplorePreviewHandler,
  joinGroup,
  getConversationMembers,
  updateConversation,
  leaveConversation: async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user._id;

      const member = await assertUserInConversation({ conversationId, userId });
      const isOwner = String(member.role || "").toUpperCase() === "OWNER";

      const out = isOwner
        ? await leaveGroupAsOwner({ conversationId, userId })
        : await removeConversationMember({ conversationId, userId });

      // System notice
      try {
        const actorName = req.user?.fullName || "Someone";
        let text = `${actorName} đã rời nhóm`;
        if (isOwner && out.newOwnerFullName) {
          text = `${actorName} đã rời nhóm. ${out.newOwnerFullName} trở thành chủ nhóm.`;
        }
        const msg = await sendConversationMessage({
          conversationId,
          senderId: userId,
          text,
          conversationType: "GROUP",
          isSystem: true,
        });
        emitGroupNewMessage(conversationId, msg);
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
      if (e.code === "NO_ELIGIBLE_SUCCESSOR") {
        return res.status(400).json({
          error: "Cần bổ nhiệm ít nhất một admin trước khi rời nhóm",
          code: "NO_ELIGIBLE_SUCCESSOR",
        });
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
        emitGroupNewMessage(conversationId, msg);
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
        emitGroupNewMessage(conversationId, msg);
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
        emitGroupNewMessage(conversationId, msg);
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
        emitGroupNewMessage(conversationId, msg);
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

