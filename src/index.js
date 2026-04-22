require("dotenv").config();
const express = require("express");
const authRoutes = require("./routes/auth.route");
const dotenv = require("dotenv");
const { connectDB } = require("./lib/db");
const cookieParser = require("cookie-parser");
const messageRoutes = require("./routes/message.route");
const mediaRoutes = require("./routes/media.route");
const livekitRoutes = require("./routes/livekit.route");
const conversationRoutes = require("./routes/conversation.route");
const friendRoutes = require("./routes/friend.route");
const aiRoutes = require("./routes/ai.route");
const cors = require("cors");
const {app, server} = require("./lib/socket");

dotenv.config();
app;

const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
}))

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/livekit", livekitRoutes);
app.use("/api/ai", aiRoutes);

server.listen(PORT, () => {
    console.log('Server is running on port:' + PORT);
    connectDB();
});