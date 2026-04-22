const express = require("express");
const {
  register,
  confirm,
  resendConfirmation,
  login,
  refresh,
  logout,
  updateProfile,
  checkAuth,
} = require("../controllers/auth.controller");
const {
  protectRoute,
  authenticateAccessToken,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/register", register);
router.post("/confirm", confirm);
router.post("/resend-confirmation", resendConfirmation);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", authenticateAccessToken, logout);

router.put("/update-profile", protectRoute, updateProfile);
router.get("/check", protectRoute, checkAuth);

module.exports = router;
