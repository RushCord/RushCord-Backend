const { getReceiverSocketId, io } = require("../lib/socket");
const { isOurPublicMediaUrl } = require("../lib/s3Media");
const { listProfilesExcept } = require("../services/userService");
const {
  listDirectMessages,
  sendDirectMessage,
  recallMessage: recallMessageSvc,
  recallMessageMe: recallMessageMeSvc,
  forwardMessage: forwardMessageSvc,
} = require("../services/messageService");

const getUsersForSideBar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const filteredUsers = await listProfilesExcept(loggedInUserId);
    res.status(200).json(filteredUsers);
  } catch (error) {
    console.error("Error in getUsersForSidebar: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;

    const messages = await listDirectMessages(myId, userToChatId);
    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const sendMessage = async (req, res) => {
  try {
    const {
      text,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
      images,
    } = req.body ?? {};
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    const hasImages = Array.isArray(images) && images.length > 0;
    const hasFile = typeof fileUrl === "string" && fileUrl.length > 0;
    const hasText = typeof text === "string" && text.trim().length > 0;

    if (!hasImages && !hasFile && !hasText) {
      return res
        .status(400)
        .json({ error: "Message text or file is required" });
    }

    if (hasImages) {
      if (hasFile) {
        return res.status(400).json({ error: "Invalid payload" });
      }
      if (images.length > 5) {
        return res.status(400).json({ error: "Too many images" });
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

      const newMessage = await sendDirectMessage({
        senderId,
        receiverId,
        text: hasText ? text.trim() : undefined,
        images: normalized,
        isForwarded: false,
      });

      const receiverSocketId = getReceiverSocketId(String(receiverId));
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", newMessage);
      }
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

    const newMessage = await sendDirectMessage({
      senderId,
      receiverId,
      text: hasText ? text.trim() : undefined,
      fileUrl: hasFile ? fileUrl : undefined,
      s3Key: hasFile ? s3Key.trim() : undefined,
      mimeType: hasFile ? mimeType : undefined,
      fileName: fileName != null ? String(fileName) : undefined,
      sizeBytes: sizeBytes != null ? Number(sizeBytes) : undefined,
      isForwarded: false,
    });

    const receiverSocketId = getReceiverSocketId(String(receiverId));

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    if (error.code === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "User not found" });
    }
    console.log("Error in sendMessage:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const recallMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user._id;

    let message;
    try {
      message = await recallMessageSvc(messageId, userId);
    } catch (e) {
      if (e.code === "NOT_ALLOWED") {
        return res.status(403).json({ error: "Not allowed" });
      }
      throw e;
    }

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const receiverSocketId = getReceiverSocketId(
      String(message.receiverId),
    );

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageRecalled", message);
    }

    const senderSocketId = getReceiverSocketId(String(userId));
    if (senderSocketId) {
      io.to(senderSocketId).emit("messageRecalled", message);
    }

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

const recallMessageMe = async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user._id;

    let message;
    try {
      message = await recallMessageMeSvc(messageId, userId);
    } catch (e) {
      if (e.code === "NOT_ALLOWED") {
        return res.status(403).json({ error: "Not allowed" });
      }
      throw e;
    }

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const senderSocketId = getReceiverSocketId(String(userId));
    if (senderSocketId) {
      io.to(senderSocketId).emit("messageRecalledMe", message);
    }

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};

const forwardMessage = async (req, res) => {
  try {
    const { messageId, receiverId } = req.body;
    const senderId = req.user._id;

    let newMessage;
    try {
      newMessage = await forwardMessageSvc({
        senderId,
        receiverId,
        sourceMessageId: messageId,
      });
    } catch (e) {
      if (e.code === "MESSAGE_NOT_FOUND") {
        return res.status(404).json({ error: "Message not found" });
      }
      if (e.code === "USER_NOT_FOUND") {
        return res.status(404).json({ error: "User not found" });
      }
      throw e;
    }

    const receiverSocketId = getReceiverSocketId(String(receiverId));
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    const senderSocketId = getReceiverSocketId(String(senderId));
    if (senderSocketId) {
      io.to(senderSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("Forward error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getUsersForSideBar,
  getMessages,
  sendMessage,
  forwardMessage,
  recallMessage,
  recallMessageMe,
};
