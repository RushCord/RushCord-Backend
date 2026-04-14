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
    origin: "http://localhost:5173",
    credentials: true,
}))

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes)

server.listen(PORT, () => {
    console.log('Server is running on port:' + PORT);
    connectDB();
});