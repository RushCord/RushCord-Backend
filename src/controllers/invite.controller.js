const {
  createGroupInvite,
  listGroupInvites,
  revokeGroupInvite,
  getInvitePreview,
  acceptGroupInvite,
} = require("../services/groupInviteService");
const {
  assertUserInConversation,
} = require("../services/conversationService");
const { sendConversationMessage } = require("../services/messageService");
const { emitGroupNewMessage } = require("./conversationMessage.controller");

function mapInviteError(e, res) {
  const code = e.code || "";
  if (code === "INVITE_NOT_FOUND") {
    return res.status(404).json({ error: "Invite not found" });
  }
  if (code === "INVITE_EXPIRED") {
    return res.status(410).json({ error: "Invite has expired" });
  }
  if (code === "INVITE_REVOKED") {
    return res.status(410).json({ error: "Invite has been revoked" });
  }
  if (code === "INVITE_MAX_USES") {
    return res.status(410).json({ error: "Invite has reached maximum uses" });
  }
  if (code === "NOT_IN_CONVERSATION" || code === "CONVERSATION_NOT_ACCEPTED") {
    return res.status(403).json({ error: "Not in conversation" });
  }
  if (code === "CONVERSATION_NOT_FOUND") {
    return res.status(404).json({ error: "Conversation not found" });
  }
  if (code === "NOT_A_GROUP") {
    return res.status(400).json({ error: "Not a group conversation" });
  }
  if (code === "USER_NOT_FOUND") {
    return res.status(404).json({ error: "User not found" });
  }
  if (code === "INVALID_EXPIRES_AT") {
    return res.status(400).json({ error: "Invalid or past expiry time" });
  }
  return null;
}

async function assertOwnerOrAdmin(conversationId, userId) {
  const member = await assertUserInConversation({ conversationId, userId });
  const role = String(member.role || "").toUpperCase();
  if (role !== "OWNER" && role !== "ADMIN") {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }
  return member;
}

const getInvitePreviewHandler = async (req, res) => {
  try {
    const code = req.params?.code;
    const preview = await getInvitePreview(code);
    return res.status(200).json(preview);
  } catch (e) {
    const mapped = mapInviteError(e, res);
    if (mapped) return mapped;
    console.error("getInvitePreview error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const acceptInviteHandler = async (req, res) => {
  try {
    const code = req.params?.code;
    const userId = req.user._id;
    const out = await acceptGroupInvite({ code, userId });

    if (!out.alreadyMember) {
      try {
        const actorName = req.user?.fullName || "Someone";
        const msg = await sendConversationMessage({
          conversationId: out.conversationId,
          senderId: userId,
          text: `${actorName} đã tham gia nhóm qua lời mời`,
          conversationType: "GROUP",
          isSystem: true,
        });
        emitGroupNewMessage(out.conversationId, msg);
      } catch {
        // best effort
      }
    }

    return res.status(out.alreadyMember ? 200 : 201).json(out);
  } catch (e) {
    const mapped = mapInviteError(e, res);
    if (mapped) return mapped;
    console.error("acceptInvite error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const listInvitesHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    await assertOwnerOrAdmin(conversationId, userId);
    const items = await listGroupInvites(conversationId);
    return res.status(200).json(items);
  } catch (e) {
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    const mapped = mapInviteError(e, res);
    if (mapped) return mapped;
    console.error("listInvites error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const createInviteHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;
    await assertOwnerOrAdmin(conversationId, userId);

    const { expiresInHours, expiresAt, maxUses } = req.body ?? {};
    const invite = await createGroupInvite({
      conversationId,
      actorId: userId,
      expiresInHours,
      expiresAt,
      maxUses,
    });
    return res.status(201).json(invite);
  } catch (e) {
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    const mapped = mapInviteError(e, res);
    if (mapped) return mapped;
    console.error("createInvite error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const revokeInviteHandler = async (req, res) => {
  try {
    const { conversationId, inviteId } = req.params;
    const userId = req.user._id;
    await assertOwnerOrAdmin(conversationId, userId);
    const out = await revokeGroupInvite({ conversationId, inviteId });
    return res.status(200).json(out);
  } catch (e) {
    if (e.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "Not allowed" });
    }
    const mapped = mapInviteError(e, res);
    if (mapped) return mapped;
    console.error("revokeInvite error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getInvitePreviewHandler,
  acceptInviteHandler,
  listInvitesHandler,
  createInviteHandler,
  revokeInviteHandler,
};
