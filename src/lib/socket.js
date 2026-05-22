const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const { verifyAccessToken } = require("./cognitoVerifier");
const { conversationChannelSocketRoom, groupVoiceRoomName } = require("./keys");
const { assertUserInConversation } = require("../services/conversationService");
const { listConversationMembers } = require("../services/conversationsService");
const {
  getChannelById,
  getDefaultVoiceChannelIdForGroup,
} = require("../services/channelsService");

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

/** LiveKit voice room presence for sidebar (roomName -> Set<userId>) */
const voiceRoomMembers = new Map();
/** socket.id -> Set<roomName> */
const socketVoiceRooms = new Map();

function voiceMembersList(roomName) {
  const set = voiceRoomMembers.get(roomName);
  return set ? [...set].sort() : [];
}

function broadcastVoicePresence(io, conversationId, roomName) {
  const cid = typeof conversationId === "string" ? conversationId.trim() : "";
  const rn = typeof roomName === "string" ? roomName.trim() : "";
  if (!cid || !rn) return;
  io.to(cid).emit("voiceChannelPresence", {
    roomName: rn,
    members: voiceMembersList(rn),
  });
}

function addToVoiceRoom(io, socket, { roomName, conversationId, userId }) {
  const rn = String(roomName || "").trim();
  const cid = String(conversationId || "").trim();
  const uid = String(userId || "").trim();
  if (!rn || !cid || !uid) return;

  if (!voiceRoomMembers.has(rn)) voiceRoomMembers.set(rn, new Set());
  voiceRoomMembers.get(rn).add(uid);

  if (!socketVoiceRooms.has(socket.id)) socketVoiceRooms.set(socket.id, new Set());
  socketVoiceRooms.get(socket.id).add(rn);

  socket.join(cid);
  broadcastVoicePresence(io, cid, rn);
}

function removeFromVoiceRoom(io, socket, { roomName, conversationId, userId }) {
  const rn = String(roomName || "").trim();
  const cid = String(conversationId || "").trim();
  const uid = String(userId || "").trim();
  if (!rn || !cid || !uid) return;

  const set = voiceRoomMembers.get(rn);
  if (set) {
    set.delete(uid);
    if (set.size === 0) voiceRoomMembers.delete(rn);
  }

  const tracked = socketVoiceRooms.get(socket.id);
  if (tracked) tracked.delete(rn);

  broadcastVoicePresence(io, cid, rn);
}

function leaveAllVoiceRoomsForSocket(io, socket) {
  const uid = socket.userId;
  const tracked = socketVoiceRooms.get(socket.id);
  if (!uid || !tracked) return;
  for (const rn of [...tracked]) {
    const cid = rn.includes("#VOICE#") ? rn.split("#VOICE#")[0] : rn;
    removeFromVoiceRoom(io, socket, { roomName: rn, conversationId: cid, userId: uid });
  }
  socketVoiceRooms.delete(socket.id);
}

/** All voice rooms + members for a group (for clients opening the group sidebar). */
function voicePresenceSnapshotForConversation(conversationId) {
  const cid = String(conversationId || "").trim();
  const rooms = {};
  if (!cid.startsWith("GROUP#")) return rooms;
  const prefix = `${cid}#VOICE#`;
  for (const [roomName, set] of voiceRoomMembers.entries()) {
    if (roomName.startsWith(prefix)) {
      rooms[roomName] = voiceMembersList(roomName);
    }
  }
  return rooms;
}

function emitVoicePresenceSnapshot(socket, conversationId) {
  const cid = String(conversationId || "").trim();
  if (!cid.startsWith("GROUP#")) return;
  socket.emit("voicePresenceSnapshot", {
    conversationId: cid,
    rooms: voicePresenceSnapshotForConversation(cid),
  });
}

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
    emitVoicePresenceSnapshot(socket, cid);
  });

  socket.on("requestVoicePresence", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    emitVoicePresenceSnapshot(socket, cid);
  });

  socket.on("leaveConversation", ({ conversationId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    socket.leave(cid);
  });

  socket.on("joinConversationChannel", ({ conversationId, channelId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    const ch = typeof channelId === "string" ? channelId.trim() : "";
    if (!cid || !ch || !cid.startsWith("GROUP#")) return;
    socket.join(conversationChannelSocketRoom(cid, ch));
  });

  socket.on("leaveConversationChannel", ({ conversationId, channelId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    const ch = typeof channelId === "string" ? channelId.trim() : "";
    if (!cid || !ch) return;
    socket.leave(conversationChannelSocketRoom(cid, ch));
  });

  socket.on("typingInConversation", ({ conversationId, channelId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    const room =
      channelId && typeof channelId === "string" && cid.startsWith("GROUP#")
        ? conversationChannelSocketRoom(cid, channelId.trim())
        : cid;
    socket.to(room).emit("typingInConversation", {
      from: userId,
      conversationId: cid,
      channelId: channelId && typeof channelId === "string" ? channelId.trim() : undefined,
    });
  });

  socket.on("stopTypingInConversation", ({ conversationId, channelId } = {}) => {
    const cid = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!cid) return;
    const room =
      channelId && typeof channelId === "string" && cid.startsWith("GROUP#")
        ? conversationChannelSocketRoom(cid, channelId.trim())
        : cid;
    socket.to(room).emit("stopTypingInConversation", {
      from: userId,
      conversationId: cid,
      channelId: channelId && typeof channelId === "string" ? channelId.trim() : undefined,
    });
  });

  // =========================
  // 🎥 LIVEKIT CALL CONTROL (no SDP/ICE signaling)
  // =========================
  socket.on("callInviteGroup", async ({ conversationId, voiceChannelId } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid || !cid.startsWith("GROUP#")) return;

      await assertUserInConversation({ conversationId: cid, userId });

      let vid = typeof voiceChannelId === "string" ? voiceChannelId.trim() : "";
      if (!vid) {
        vid = (await getDefaultVoiceChannelIdForGroup(cid)) || "";
      }
      if (!vid) return;

      const ch = await getChannelById(cid, vid);
      if (!ch || ch.channelType !== "VOICE") return;

      const roomName = groupVoiceRoomName(cid, vid);

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
          roomName,
          conversationId: cid,
          voiceChannelId: vid,
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

  socket.on("voiceChannelJoin", async ({ conversationId, voiceChannelId, roomName } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid || !cid.startsWith("GROUP#")) return;
      await assertUserInConversation({ conversationId: cid, userId });

      let rn = typeof roomName === "string" ? roomName.trim() : "";
      if (!rn) {
        let vid = typeof voiceChannelId === "string" ? voiceChannelId.trim() : "";
        if (!vid) vid = (await getDefaultVoiceChannelIdForGroup(cid)) || "";
        if (vid) rn = groupVoiceRoomName(cid, vid);
      }
      if (!rn) return;

      addToVoiceRoom(io, socket, { roomName: rn, conversationId: cid, userId });
    } catch (e) {
      console.error("voiceChannelJoin error:", e?.message || e);
    }
  });

  socket.on("voiceChannelLeave", async ({ conversationId, voiceChannelId, roomName } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid || !cid.startsWith("GROUP#")) return;

      let rn = typeof roomName === "string" ? roomName.trim() : "";
      if (!rn) {
        let vid = typeof voiceChannelId === "string" ? voiceChannelId.trim() : "";
        if (!vid) vid = (await getDefaultVoiceChannelIdForGroup(cid)) || "";
        if (vid) rn = groupVoiceRoomName(cid, vid);
      }
      if (!rn) return;

      removeFromVoiceRoom(io, socket, {
        roomName: rn,
        conversationId: cid,
        userId,
      });
    } catch (e) {
      console.error("voiceChannelLeave error:", e?.message || e);
    }
  });

  socket.on("hangupGroup", async ({ conversationId, voiceChannelId, roomName } = {}) => {
    try {
      const cid = typeof conversationId === "string" ? conversationId.trim() : "";
      if (!cid || !cid.startsWith("GROUP#")) return;
      await assertUserInConversation({ conversationId: cid, userId });

      let room =
        typeof roomName === "string" && roomName.trim().length > 0 ? roomName.trim() : "";
      if (!room) {
        let vid = typeof voiceChannelId === "string" ? voiceChannelId.trim() : "";
        if (!vid) {
          vid = (await getDefaultVoiceChannelIdForGroup(cid)) || "";
        }
        if (vid) room = groupVoiceRoomName(cid, vid);
        else room = cid;
      }

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
          roomName: room,
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

    leaveAllVoiceRoomsForSocket(io, socket);

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
