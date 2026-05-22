const { isOurPublicMediaUrl } = require("../lib/s3Media");
const {
  toPublicUser,
  updateUserProfile,
} = require("../services/userService");
const cognitoAuth = require("../services/cognitoAuthService");
const emailChangeService = require("../services/emailChangeService");

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

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeGenderInput(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return { ok: true, value: "" };
  if (s === "MALE" || s === "FEMALE" || s === "OTHER") return { ok: true, value: s };
  return { ok: false };
}

function validateDateOfBirthInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return {
      ok: false,
      message: "dateOfBirth must be YYYY-MM-DD or empty",
    };
  }
  const [y, mo, d] = s.split("-").map((x) => parseInt(x, 10));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return { ok: false, message: "Invalid date of birth" };
  }
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (
    birth.getUTCFullYear() !== y ||
    birth.getUTCMonth() !== mo - 1 ||
    birth.getUTCDate() !== d
  ) {
    return { ok: false, message: "Invalid date of birth" };
  }
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (birth > todayUtc) {
    return { ok: false, message: "Date of birth cannot be in the future" };
  }
  const oldest = new Date(
    Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()),
  );
  if (birth < oldest) {
    return { ok: false, message: "Date of birth is not plausible" };
  }
  return { ok: true, value: s };
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
      const userId = req.user._id;
      const body = req.body || {};
      const updates = {};

      if (hasOwn(body, "profilePic")) {
        const profilePic = body.profilePic;
        if (typeof profilePic !== "string" || !profilePic.trim()) {
          return res.status(400).json({ message: "Profile picture URL is invalid" });
        }
        const trimmed = profilePic.trim();
        if (!isOurPublicMediaUrl(trimmed)) {
          return res.status(400).json({ message: "Invalid profile picture URL" });
        }
        updates.avatarUrl = trimmed;
      }

      if (hasOwn(body, "coverPic")) {
        const coverPic = body.coverPic;
        if (typeof coverPic !== "string" || !coverPic.trim()) {
          return res.status(400).json({ message: "Cover image URL is invalid" });
        }
        const trimmed = coverPic.trim();
        if (!isOurPublicMediaUrl(trimmed)) {
          return res.status(400).json({ message: "Invalid cover image URL" });
        }
        updates.coverImageUrl = trimmed;
      }

      if (hasOwn(body, "fullName")) {
        const fullName = String(body.fullName ?? "").trim().replace(/\s+/g, " ");
        if (!fullName) {
          return res.status(400).json({ message: "fullName cannot be empty" });
        }
        if (fullName.length > 120) {
          return res.status(400).json({ message: "fullName is too long" });
        }
        updates.fullName = fullName;
      }

      if (hasOwn(body, "dateOfBirth")) {
        const dob = validateDateOfBirthInput(body.dateOfBirth);
        if (!dob.ok) {
          return res.status(400).json({ message: dob.message || "Invalid date of birth" });
        }
        updates.dateOfBirth = dob.value;
      }

      if (hasOwn(body, "gender")) {
        const g = normalizeGenderInput(body.gender);
        if (!g.ok) {
          return res.status(400).json({ message: "gender must be MALE, FEMALE, OTHER, or empty" });
        }
        updates.gender = g.value;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          message:
            "Provide at least one of: profilePic, coverPic, fullName, dateOfBirth, gender",
        });
      }

      const updated = await updateUserProfile(userId, updates);

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

  changePassword: async (req, res) => {
    try {
      const accessToken = req.accessToken;
      if (!accessToken) {
        return res.status(401).json({
          message: "Unauthorized",
          code: "UNAUTHENTICATED",
        });
      }
      const currentPassword = String(req.body?.currentPassword ?? "");
      const newPassword = String(req.body?.newPassword ?? "");
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          message: "Current password and new password are required",
          code: "VALIDATION_ERROR",
        });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
          code: "VALIDATION_ERROR",
        });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({
          message: "New password must be different from current password",
          code: "VALIDATION_ERROR",
        });
      }
      await cognitoAuth.changePassword({
        accessToken,
        currentPassword,
        newPassword,
      });
      res.status(200).json({ changed: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  forgotPassword: async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({
          message: "Email is required",
          code: "VALIDATION_ERROR",
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          message: "Invalid email format",
          code: "VALIDATION_ERROR",
        });
      }
      try {
        await cognitoAuth.forgotPassword({ email });
      } catch (err) {
        if (err.code === "USER_NOT_FOUND") {
          return res.status(200).json({ sent: true });
        }
        throw err;
      }
      res.status(200).json({ sent: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  resetPassword: async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otpCode = String(req.body?.otpCode ?? "").trim();
      const newPassword = String(req.body?.newPassword ?? "");
      if (!email) {
        return res.status(400).json({
          message: "Email is required",
          code: "VALIDATION_ERROR",
        });
      }
      if (!/^\d{6}$/.test(otpCode)) {
        return res.status(400).json({
          message: "Verification code must be 6 digits",
          code: "VALIDATION_ERROR",
        });
      }
      if (!newPassword) {
        return res.status(400).json({
          message: "New password is required",
          code: "VALIDATION_ERROR",
        });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
          code: "VALIDATION_ERROR",
        });
      }
      await cognitoAuth.confirmForgotPassword({ email, otpCode, newPassword });
      res.status(200).json({ reset: true });
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  requestEmailChange: async (req, res) => {
    try {
      const newEmail = normalizeEmail(req.body?.newEmail);
      const password = String(req.body?.password ?? "");
      if (!newEmail) {
        return res.status(400).json({
          message: "New email is required",
          code: "VALIDATION_ERROR",
        });
      }
      if (!password) {
        return res.status(400).json({
          message: "Password is required",
          code: "VALIDATION_ERROR",
        });
      }
      const data = await emailChangeService.requestEmailChange({
        userSub: req.user._id,
        oldEmail: req.user.email,
        newEmail,
        password,
      });
      res.status(200).json(data);
    } catch (err) {
      sendCognitoError(res, err);
    }
  },

  confirmEmailChange: async (req, res) => {
    try {
      const token = String(req.body?.token ?? "").trim();
      if (!token) {
        return res.status(400).json({
          message: "Token is required",
          code: "VALIDATION_ERROR",
        });
      }
      const data = await emailChangeService.confirmEmailChange({ token });
      res.status(200).json(data);
    } catch (err) {
      sendCognitoError(res, err);
    }
  },
};
