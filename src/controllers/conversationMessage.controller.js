const { isOurPublicMediaUrl } = require("../lib/s3Media");
const { assertUserInConversation } = require("../services/conversationService");
const {
  listConversationMessages,
  sendConversationMessage,
} = require("../services/messageService");
const { io } = require("../lib/socket");

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
    } = req.body ?? {};

    await assertUserInConversation({ conversationId, userId: senderId });

    const hasImages = Array.isArray(images) && images.length > 0;
    const hasFile = typeof fileUrl === "string" && fileUrl.length > 0;
    const hasText = typeof text === "string" && text.trim().length > 0;

    if (!hasImages && !hasFile && !hasText) {
      return res.status(400).json({ error: "Message text or file is required" });
    }

    if (hasImages) {
      if (hasFile) return res.status(400).json({ error: "Invalid payload" });
      if (images.length > 5) return res.status(400).json({ error: "Too many images" });
      const expectedPrefix = `messages/${senderId}/`;
      const normalized = [];
      for (const it of images) {
        const fileUrl2 = it?.fileUrl;
        const s3Key2 = it?.s3Key;
        const mime2 = it?.mimeType;
        const fileName2 = it?.fileName;
        const sizeBytes2 = it?.sizeBytes;

        if (typeof fileUrl2 !== "string" || fileUrl2.length === 0) {
          return res.status(400).json({ error: "Invalid file URL" });
        }
        if (!isOurPublicMediaUrl(fileUrl2)) {
          return res.status(400).json({ error: "Invalid file URL" });
        }
        if (typeof s3Key2 !== "string" || s3Key2.trim().length === 0) {
          return res.status(400).json({ error: "s3Key is required with file" });
        }
        const s3KeyTrimmed = s3Key2.trim();
        if (!s3KeyTrimmed.startsWith(expectedPrefix)) {
          return res.status(400).json({ error: "Invalid s3Key" });
        }
        if (typeof mime2 !== "string" || !mime2.startsWith("image/")) {
          return res.status(400).json({ error: "Invalid mimeType" });
        }
        normalized.push({
          fileUrl: fileUrl2,
          s3Key: s3KeyTrimmed,
          mimeType: mime2,
          fileName: fileName2 != null ? String(fileName2) : "image",
          sizeBytes: sizeBytes2 != null ? Number(sizeBytes2) : 0,
        });
      }

      const newMessage = await sendConversationMessage({
        conversationId,
        senderId,
        text: hasText ? text.trim() : undefined,
        images: normalized,
        isForwarded: false,
        conversationType: "GROUP",
      });

      io.to(conversationId).emit("newMessage", newMessage);
      return res.status(201).json(newMessage);
    }

    if (hasFile) {
      if (!isOurPublicMediaUrl(fileUrl)) {
        return res.status(400).json({ error: "Invalid file URL" });
      }
      if (typeof s3Key !== "string" || s3Key.trim().length === 0) {
        return res.status(400).json({ error: "s3Key is required with file" });
      }
      const s3KeyTrimmed = s3Key.trim();
      const expectedPrefix = `messages/${senderId}/`;
      if (!s3KeyTrimmed.startsWith(expectedPrefix)) {
        return res.status(400).json({ error: "Invalid s3Key" });
      }
      if (!mimeType || typeof mimeType !== "string") {
        return res.status(400).json({ error: "mimeType is required with file" });
      }
    }

    const newMessage = await sendConversationMessage({
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
    });

    io.to(conversationId).emit("newMessage", newMessage);
    return res.status(201).json(newMessage);
  } catch (e) {
    if (e.code === "NOT_IN_CONVERSATION") {
      return res.status(403).json({ error: "Not in conversation" });
    }
    if (e.code === "CONVERSATION_NOT_ACCEPTED") {
      return res.status(403).json({ error: "Conversation not accepted" });
    }
    console.error("sendConversationMessage error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getConversationMessages,
  sendConversationMessageHandler,
};

