const { isOurPublicMediaUrl } = require("../lib/s3Media");
const {
  getProfileRaw,
  toPublicUser,
  updateProfileAvatar,
} = require("../services/userService");
const cognitoAuth = require("../services/cognitoAuthService");

function sendCognitoError(res, err) {
  if (err.statusCode && err.code) {
    return res.status(err.statusCode).json({
      message: err.message,
      code: err.code,
    });
  }
  console.error("Auth error:", err);
  return res.status(500).json({ message: "Server error" });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateRegisterBody(body) {
  const displayName = String(body.displayName ?? body.fullName ?? "").trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  if (!displayName) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Display name is required" } };
  }
  if (!email) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Email is required" } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Invalid email format" } };
  }
  if (!password) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Password is required" } };
  }
  if (password.length < 8) {
    return {
      error: {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Password must be at least 8 characters",
      },
    };
  }
  return { displayName, email, password };
}

function validateConfirmBody(body) {
  const email = normalizeEmail(body.email);
  const otpCode = String(body.otpCode ?? "").trim();
  if (!email) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Email is required" } };
  }
  if (!/^\d{6}$/.test(otpCode)) {
    return {
      error: {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Verification code must be 6 digits",
      },
    };
  }
  return { email, otpCode };
}

function validateLoginBody(body) {
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  if (!email || !password) {
    return { error: { status: 400, code: "VALIDATION_ERROR", message: "Email and password are required" } };
  }
  return { email, password };
}

module.exports = {
  register: async (req, res) => {
    try {
      const v = validateRegisterBody(req.body);
      if (v.error) {
        return res.status(v.error.status).json({
          message: v.error.message,
          code: v.error.code,
        });
      }
      const data = await cognitoAuth.signUp({
        email: v.email,
        password: v.password,
        displayName: v.displayName,
      });
      res.status(201).json(data);
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  confirm: async (req, res) => {
    try {
      const v = validateConfirmBody(req.body);
      if (v.error) {
        return res.status(v.error.status).json({
          message: v.error.message,
          code: v.error.code,
        });
      }
      await cognitoAuth.confirmSignUp({ email: v.email, otpCode: v.otpCode });
      res.status(200).json({ confirmed: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  resendConfirmation: async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({
          message: "Email is required",
          code: "VALIDATION_ERROR",
        });
      }
      await cognitoAuth.resendConfirmationCode({ email });
      res.status(200).json({ sent: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  login: async (req, res) => {
    try {
      const v = validateLoginBody(req.body);
      if (v.error) {
        return res.status(v.error.status).json({
          message: v.error.message,
          code: v.error.code,
        });
      }
      const tokens = await cognitoAuth.signInWithPassword({
        email: v.email,
        password: v.password,
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(tokens);
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  refresh: async (req, res) => {
    try {
      const refreshToken = String(req.body?.refreshToken ?? "").trim();
      if (!refreshToken) {
        return res.status(400).json({
          message: "refreshToken is required",
          code: "VALIDATION_ERROR",
        });
      }
      const tokens = await cognitoAuth.refreshSession({ refreshToken });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(tokens);
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  logout: async (req, res) => {
    try {
      const accessToken = req.accessToken;
      if (!accessToken) {
        return res.status(401).json({ message: "Unauthorized", code: "UNAUTHENTICATED" });
      }
      const { refreshToken, allDevices } = req.body || {};
      if (allDevices === true) {
        await cognitoAuth.globalSignOut({ accessToken });
      }
      if (refreshToken !== undefined && String(refreshToken).trim().length > 0) {
        await cognitoAuth.revokeRefreshToken({
          refreshToken: String(refreshToken).trim(),
        });
      }
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ signedOut: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  updateProfile: async (req, res) => {
    try {
      const { profilePic } = req.body;
      const userId = req.user._id;

      if (!profilePic || typeof profilePic !== "string") {
        return res
          .status(400)
          .json({ message: "Profile picture URL is required" });
      }

      if (!isOurPublicMediaUrl(profilePic.trim())) {
        return res.status(400).json({ message: "Invalid profile picture URL" });
      }

      await updateProfileAvatar(userId, profilePic.trim());
      const updated = await getProfileRaw(userId);

      res.status(200).json(toPublicUser(updated));
    } catch (error) {
      console.error("Error in updateProfile:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  },

  checkAuth: async (req, res) => {
    try {
      res.status(200).json(req.user);
    } catch (error) {
      console.error("Error in checkAuth:", error.message);
      res.status(500).json({ message: "Server error" });
    }
  },
};
