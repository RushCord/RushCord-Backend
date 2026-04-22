const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const { verifyAccessToken } = require("./cognitoVerifier");
const { assertUserInConversation } = require("../services/conversationService");
const { listConversationMembers } = require("../services/conversationsService");

const app = express();
const server = http.createServer(app);

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS,
  },
});

const userSocketMap = {}; // {userId: socketId}

function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");
    if (!token || typeof token !== "string") {
      return next(new Error("Unauthorized: missing token"));
    }
    const { sub } = await verifyAccessToken(token.trim());
    socket.userId = sub;
    next();
  } catch (e) {
    next(new Error("Unauthorized: invalid token"));
  }
});

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.userId;

  if (userId) {
    userSocketMap[userId] = socket.id;
  }

  // ===== ONLINE USERS =====
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // =========================
  // 💬 TYPING INDICATOR
  // =========================
  socket.on("typing", ({ to } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("typing", { from: userId });
    }
  });

  socket.on("stopTyping", ({ to } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("stopTyping", { from: userId });
    }
  });

  // =========================
  // 🧩 CONVERSATION ROOMS (GROUP/DM)
  // =========================
  socket.on("joinConversation", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    socket.join(cid);
  });

  socket.on("leaveConversation", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    socket.leave(cid);
  });

  socket.on("typingInConversation", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    socket.to(cid).emit("typingInConversation", { from: userId, conversationId: cid });
  });

  socket.on("stopTypingInConversation", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    socket.to(cid).emit("stopTypingInConversation", { from: userId, conversationId: cid });
  });

  // =========================
  // 🎥 LIVEKIT CALL CONTROL (no SDP/ICE signaling)
  // =========================
  socket.on("callInviteGroup", async ({ conversationId } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid) return;

      // Permission: only members can start/invite into the room.
      await assertUserInConversation({ conversationId: cid, userId });

      const members = await listConversationMembers(cid);
      for (const m of Array.isArray(members) ? members : []) {
        const memberUserId = m?.userId ? String(m.userId) : "";
        if (!memberUserId) continue;
        if (memberUserId === String(userId)) continue;
        if (m?.status && String(m.status).toUpperCase() !== "ACCEPTED") continue;

        const receiverSocketId = getReceiverSocketId(memberUserId);
        if (!receiverSocketId) continue;
        io.to(receiverSocketId).emit("incomingCall", {
          from: userId,
          roomName: cid,
          conversationId: cid,
          kind: "GROUP",
        });
      }
    } catch (e) {
      // best effort; do not crash socket handler
      console.error("callInviteGroup error:", e?.message || e);
    }
  });

  socket.on("callInvite", ({ to, roomName } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("incomingCall", {
        from: userId,
        roomName,
        kind: "DM",
      });
    }
  });

  socket.on("callAccept", ({ to, roomName } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("callAccepted", {
        from: userId,
        roomName,
      });
    }
  });

  socket.on("callReject", ({ to, roomName } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("callRejected", {
        from: userId,
        roomName,
      });
    }
  });

  socket.on("hangup", ({ to, roomName } = {}) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("hangup", {
        from: userId,
        roomName,
      });
    }
  });

  socket.on("hangupGroup", async ({ conversationId } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid) return;
      await assertUserInConversation({ conversationId: cid, userId });

      const members = await listConversationMembers(cid);
      for (const m of Array.isArray(members) ? members : []) {
        const memberUserId = m?.userId ? String(m.userId) : "";
        if (!memberUserId) continue;
        if (memberUserId === String(userId)) continue;
        if (m?.status && String(m.status).toUpperCase() !== "ACCEPTED") continue;

        const receiverSocketId = getReceiverSocketId(memberUserId);
        if (!receiverSocketId) continue;
        io.to(receiverSocketId).emit("hangup", {
          from: userId,
          roomName: cid,
          conversationId: cid,
          kind: "GROUP",
        });
      }
    } catch (e) {
      console.error("hangupGroup error:", e?.message || e);
    }
  });

  // =========================

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);

    if (userId) {
      delete userSocketMap[userId];
    }

    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

module.exports = {
  app,
  io,
  server,
  getReceiverSocketId,
};
