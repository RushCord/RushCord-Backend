const { Server } = require("socket.io");
const http = require("http");
const express = require("express");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"],
  },
});

const userSocketMap = {}; // {userId: socketId}

function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;

  if (userId) {
    userSocketMap[userId] = socket.id;
  }

  // ===== ONLINE USERS =====
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // =========================
  // 🔥 WEBRTC SIGNALING
  // =========================

  // 📞 Gửi offer (gọi)
  socket.on("callUser", ({ to, offer }) => {
    const receiverSocketId = getReceiverSocketId(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("incomingCall", {
        from: userId,
        offer,
      });
    }
  });

  // 📩 Gửi answer (trả lời)
  socket.on("answerCall", ({ to, answer }) => {
    const receiverSocketId = getReceiverSocketId(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("callAnswered", {
        from: userId,
        answer,
      });
    }
  });

  // 🌐 ICE Candidate
  socket.on("iceCandidate", ({ to, candidate }) => {
    const receiverSocketId = getReceiverSocketId(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("iceCandidate", {
        from: userId,
        candidate,
      });
    }
  });

  // 🔚 Hangup
  socket.on("hangup", ({ to }) => {
    const receiverSocketId = getReceiverSocketId(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("hangup", {
        from: userId,
      });
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
