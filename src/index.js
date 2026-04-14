const express = require("express");
const authRoutes = require("./routes/auth.route");
const dotenv = require("dotenv");
const { connectDB } = require("./lib/db");
const cookieParser = require("cookie-parser");
const messageRoutes = require("./routes/message.route");
const cors = require("cors");
const {app, server} = require("./lib/socket");

dotenv.config();
app

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: (origin, callback) => {
        // Cho phép web frontend, mobile app (không có origin), và local network
        const allowedOrigins = ["http://localhost:5173", "http://localhost:8081"];
        if (!origin || allowedOrigins.includes(origin) || /^http:\/\/192\.168\.\d+\.\d+/.test(origin) || /^http:\/\/10\.0\.\d+\.\d+/.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
}))

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes)

server.listen(PORT, () => {
    console.log('Server is running on port:' + PORT);
    connectDB();
});