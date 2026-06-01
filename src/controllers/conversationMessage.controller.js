const { isOurPublicMediaUrl } = require("../lib/s3Media");
const { conversationChannelSocketRoom } = require("../lib/keys");
const { assertUserInConversation, getConversationMember } = require("../services/conversationService");
const { getChannelById } = require("../services/channelsService");
const {
  listConversationMessages,
  sendConversationMessage,
  searchConversationMessages,
} = require("../services/messageService");
const { io } = require("../lib/socket");

function emitGroupNewMessage(conversationId, newMessage) {
  const ch = String(newMessage?.channelId || "");
  if (ch && String(conversationId || "").startsWith("GROUP#")) {
    io.to(conversationChannelSocketRoom(conversationId, ch)).emit("newMessage", newMessage);
    return;
  }
  io.to(conversationId).emit("newMessage", newMessage);
}

async function assertCanPostToChannel({ conversationId, channelId, senderId }) {
  const ch = await getChannelById(conversationId, channelId);
  if (!ch) {
    const err = new Error("CHANNEL_NOT_FOUND");
    err.code = "CHANNEL_NOT_FOUND";
    throw err;
  }
  if (ch.channelType === "INFO") {
    const mem = await getConversationMember({ conversationId, userId: senderId });
    const r = String(mem?.role || "").toUpperCase();
    if (r !== "OWNER" && r !== "ADMIN") {
      const err = new Error("INFO_POST_FORBIDDEN");
      err.code = "INFO_POST_FORBIDDEN";
      throw err;
    }
  }
}

const searchConversationMessagesHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const viewerId = req.user._id;
    const q = String(req.query.q || "").trim();
    const limit = req.query.limit;

    if (q.length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }

    await assertUserInConversation({ conversationId, userId: viewerId });
    const results = await searchConversationMessages(viewerId, conversationId, q, {
      limit,
    });
    return res.status(200).json(results);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    console.error("searchConversationMessagesHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const viewerId = req.user._id;

    await assertUserInConversation({ conversationId, userId: viewerId });
    const messages = await listConversationMessages(viewerId, conversationId);
    return res.status(200).json(messages);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    console.error("getConversationMessages error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getChannelMessages = async (req, res) => {
  try {
    const { conversationId, channelId } = req.params;
    const viewerId = req.user._id;
    await assertUserInConversation({ conversationId, userId: viewerId });
    const messages = await listConversationMessages(viewerId, conversationId, channelId);
    return res.status(200).json(messages);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    console.error("getChannelMessages error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

async function buildAndSendGroupMessage({
  conversationId,
  channelId,
  senderId,
  text,
  fileUrl,
  s3Key,
  mimeType,
  fileName,
  sizeBytes,
  images,
}) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasFile = typeof fileUrl === "string" && fileUrl.length > 0;
  const hasText = typeof text === "string" && text.trim().length > 0;

  if (!hasImages && !hasFile && !hasText) {
    const err = new Error("EMPTY_MESSAGE");
    err.code = "EMPTY_MESSAGE";
    throw err;
  }

  if (hasImages) {
    if (hasFile) {
      const err = new Error("INVALID_PAYLOAD");
      err.code = "INVALID_PAYLOAD";
      throw err;
    }
    if (images.length > 5) {
      const err = new Error("TOO_MANY_IMAGES");
      err.code = "TOO_MANY_IMAGES";
      throw err;
    }
    const expectedPrefix = `messages/${senderId}/`;
    const normalized = [];
    for (const it of images) {
      const fileUrl2 = it?.fileUrl;
      const s3Key2 = it?.s3Key;
      const mime2 = it?.mimeType;
      const fileName2 = it?.fileName;
      const sizeBytes2 = it?.sizeBytes;

      if (typeof fileUrl2 !== "string" || fileUrl2.length === 0) {
        const err = new Error("INVALID_FILE_URL");
        err.code = "INVALID_FILE_URL";
        throw err;
      }
      if (!isOurPublicMediaUrl(fileUrl2)) {
        const err = new Error("INVALID_FILE_URL");
        err.code = "INVALID_FILE_URL";
        throw err;
      }
      if (typeof s3Key2 !== "string" || s3Key2.trim().length === 0) {
        const err = new Error("INVALID_S3KEY");
        err.code = "INVALID_S3KEY";
        throw err;
      }
      const s3KeyTrimmed = s3Key2.trim();
      if (!s3KeyTrimmed.startsWith(expectedPrefix)) {
        const err = new Error("INVALID_S3KEY");
        err.code = "INVALID_S3KEY";
        throw err;
      }
      if (typeof mime2 !== "string" || !mime2.startsWith("image/")) {
        const err = new Error("INVALID_MIME");
        err.code = "INVALID_MIME";
        throw err;
      }
      normalized.push({
        fileUrl: fileUrl2,
        s3Key: s3KeyTrimmed,
        mimeType: mime2,
        fileName: fileName2 != null ? String(fileName2) : "image",
        sizeBytes: sizeBytes2 != null ? Number(sizeBytes2) : 0,
      });
    }

    return sendConversationMessage({
      conversationId,
      senderId,
      text: hasText ? text.trim() : undefined,
      images: normalized,
      isForwarded: false,
      conversationType: "GROUP",
      channelId,
    });
  }

  if (hasFile) {
    if (!isOurPublicMediaUrl(fileUrl)) {
      const err = new Error("INVALID_FILE_URL");
      err.code = "INVALID_FILE_URL";
      throw err;
    }
    if (typeof s3Key !== "string" || s3Key.trim().length === 0) {
      const err = new Error("INVALID_S3KEY");
      err.code = "INVALID_S3KEY";
      throw err;
    }
    const s3KeyTrimmed = s3Key.trim();
    const expectedPrefix = `messages/${senderId}/`;
    if (!s3KeyTrimmed.startsWith(expectedPrefix)) {
      const err = new Error("INVALID_S3KEY");
      err.code = "INVALID_S3KEY";
      throw err;
    }
    if (!mimeType || typeof mimeType !== "string") {
      const err = new Error("INVALID_MIME");
      err.code = "INVALID_MIME";
      throw err;
    }
  }

  return sendConversationMessage({
    conversationId,
    senderId,
    text: hasText ? text.trim() : undefined,
    fileUrl: hasFile ? fileUrl : undefined,
    s3Key: hasFile ? s3Key.trim() : undefined,
    mimeType: hasFile ? mimeType : undefined,
    fileName: fileName != null ? String(fileName) : undefined,
    sizeBytes: sizeBytes != null ? Number(sizeBytes) : undefined,
    isForwarded: false,
    conversationType: "GROUP",
    channelId,
  });
}

const sendChannelMessageHandler = async (req, res) => {
  try {
    const { conversationId, channelId } = req.params;
    const senderId = req.user._id;
    const {
      text,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
      images,
    } = req.body ?? {};

    await assertUserInConversation({ conversationId, userId: senderId });
    await assertCanPostToChannel({ conversationId, channelId, senderId });

    const newMessage = await buildAndSendGroupMessage({
      conversationId,
      channelId,
      senderId,
      text,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
      images,
    });

    emitGroupNewMessage(conversationId, newMessage);
    return res.status(201).json(newMessage);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION" || e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "INFO_POST_FORBIDDEN") {
      return res.status(403).json({ error: "Only owner or admin can post to this channel" });
    }
    if (e.code === "CHANNEL_NOT_FOUND") {
      return res.status(404).json({ error: "Channel not found" });
    }
    if (e.code === "CHANNEL_REQUIRED" || e.code === "CANNOT_MESSAGE_VOICE") {
      return res.status(400).json({ error: "Invalid channel for messages" });
    }
    if (e.code === "EMPTY_MESSAGE") {
      return res.status(400).json({ error: "Message text or file is required" });
    }
    if (e.code === "INVALID_PAYLOAD") {
      return res.status(400).json({ error: "Invalid payload" });
    }
    if (e.code === "TOO_MANY_IMAGES") {
      return res.status(400).json({ error: "Too many images" });
    }
    if (e.code === "INVALID_FILE_URL" || e.code === "INVALID_S3KEY" || e.code === "INVALID_MIME") {
      return res.status(400).json({ error: "Invalid file upload" });
    }
    console.error("sendChannelMessageHandler error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const sendConversationMessageHandler = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const senderId = req.user._id;
    const {
      text,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
      images,
      channelId: bodyChannelId,
    } = req.body ?? {};

    await assertUserInConversation({ conversationId, userId: senderId });

    if (String(conversationId || "").startsWith("GROUP#")) {
      if (!bodyChannelId || typeof bodyChannelId !== "string") {
        return res.status(400).json({
          error: "channelId is required in body for group messages (or use /channels/:channelId/messages)",
        });
      }
      await assertCanPostToChannel({
        conversationId,
        channelId: bodyChannelId,
        senderId,
      });
    }

    const newMessage = await buildAndSendGroupMessage({
      conversationId,
      channelId: bodyChannelId,
      senderId,
      text,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
      images,
    });

    emitGroupNewMessage(conversationId, newMessage);
    return res.status(201).json(newMessage);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    if (e.code === "INFO_POST_FORBIDDEN") {
      return res.status(403).json({ error: "Only owner or admin can post to this channel" });
    }
    if (e.code === "CHANNEL_NOT_FOUND") {
      return res.status(404).json({ error: "Channel not found" });
    }
    console.error("sendConversationMessage error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  searchConversationMessagesHandler,
  getConversationMessages,
  getChannelMessages,
  sendConversationMessageHandler,
  sendChannelMessageHandler,
  emitGroupNewMessage,
};
