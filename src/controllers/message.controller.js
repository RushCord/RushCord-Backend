const Message = require("../models/message.model");
const User = require("../models/user.model");
const { cloudinary } = require("../lib/cloudinary");
const { getReceiverSocketId, io } = require("../lib/socket");

const getUsersForSideBar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const filteredUsers = await User.find({
      _id: { $ne: loggedInUserId },
    }).select("-password");

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

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    });

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { text, image } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let imageUrl = null;
    let fileUrl = null;

    // =========================
    // IMAGE (base64)
    // =========================
    if (image) {
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
    }

    // =========================
    // FILE (multer)
    // =========================
    if (req.file) {
      const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      const uploadResponse = await cloudinary.uploader.upload(base64File, {
        resource_type: "auto", // 🔥 cho phép mọi file
      });

      fileUrl = uploadResponse.secure_url;
    }

    console.log("FILE:", req.file);
    console.log("BODY:", req.body);

    // =========================
    // CREATE MESSAGE
    // =========================
    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      image: imageUrl,
      file: fileUrl,
    });

    await newMessage.save();

    // =========================
    // SOCKET REALTIME
    // =========================
    const receiverSocketId = getReceiverSocketId(receiverId);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Error in sendMessage:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const recallMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // ❗ chỉ cho phép người gửi thu hồi
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not allowed" });
    }

    message.isRecalled = true;
    await message.save();

    // 🔥 realtime cho người nhận
    const receiverSocketId = getReceiverSocketId(message.receiverId.toString());

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageRecalled", message);
    }

    // gửi lại cho chính mình (optional)
    io.to(getReceiverSocketId(userId)).emit("messageRecalled", message);

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

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const newMessage = new Message({
      senderId,
      receiverId,
      text: message.text,
      image: message.image,
      file: message.file,
      isForwarded: true,
      originalMessageId: message._id,
    });

    await newMessage.save();

    // realtime
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    // 🔥 THÊM ĐOẠN NÀY
    const senderSocketId = getReceiverSocketId(senderId.toString());
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
};
