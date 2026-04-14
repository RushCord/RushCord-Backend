const jwt = require("jsonwebtoken");
const generateToken = (userId, res) =>{
    const token = jwt.sign({userId}, process.env.JWT_SECRET, {
        expiresIn: "7d",
    })

    res.cookie("jwt",token, {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: "strict",
        secure:process.env.NODE_ENV !== "development",
    })

    return token;
}

const getFileName = (url) => {
  try {
    return url.split("/").pop().split("?")[0];
  } catch {
    return "file";
  }
};

module.exports = {
    generateToken,
    getFileName
}