jest.mock("../../src/services/cognitoAuthService", () => ({
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  resendConfirmationCode: jest.fn(),
  signInWithPassword: jest.fn(),
  refreshSession: jest.fn(),
  revokeRefreshToken: jest.fn(),
  globalSignOut: jest.fn(),
  changePassword: jest.fn(),
  forgotPassword: jest.fn(),
  confirmForgotPassword: jest.fn(),
}));
const emailChangeService = require("../../src/services/emailChangeService");
jest.mock("../../src/services/emailChangeService", () => ({
  requestEmailChange: jest.fn(),
  confirmEmailChange: jest.fn(),
}));
jest.mock("../../src/lib/s3Media", () => ({
  isOurPublicMediaUrl: jest.fn(),
}));
jest.mock("../../src/services/userService", () => ({
  toPublicUser: jest.fn((p) => p),
  updateUserProfile: jest.fn(),
}));

const cognitoAuth = require("../../src/services/cognitoAuthService");
const { isOurPublicMediaUrl } = require("../../src/lib/s3Media");
const { updateUserProfile } = require("../../src/services/userService");
const authController = require("../../src/controllers/auth.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("auth.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cognitoAuth.signUp.mockResolvedValue({ userSub: "sub-1", pendingConfirmation: true });
    updateUserProfile.mockResolvedValue({ userId: "u1", fullName: "Alice" });
    isOurPublicMediaUrl.mockReturnValue(true);
  });

  describe("register", () => {
    test("returns 400 for invalid email without calling signUp", async () => {
      const req = createMockReq({
        body: { displayName: "A", email: "bad", password: "password1" },
      });
      const res = createMockRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(cognitoAuth.signUp).not.toHaveBeenCalled();
    });

    test("returns 400 for short password", async () => {
      const req = createMockReq({
        body: { displayName: "A", email: "a@b.com", password: "short" },
      });
      const res = createMockRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.signUp).not.toHaveBeenCalled();
    });

    test("returns 400 when displayName missing", async () => {
      const req = createMockReq({
        body: { email: "a@b.com", password: "password1" },
      });
      const res = createMockRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.signUp).not.toHaveBeenCalled();
    });

    test("returns 201 and calls signUp for valid body", async () => {
      const req = createMockReq({
        body: { displayName: "Alice", email: "a@b.com", password: "password1" },
      });
      const res = createMockRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(cognitoAuth.signUp).toHaveBeenCalledWith({
        email: "a@b.com",
        password: "password1",
        displayName: "Alice",
      });
    });

    test("maps cognito error via sendCognitoError", async () => {
      cognitoAuth.signUp.mockRejectedValue({
        statusCode: 409,
        code: "EMAIL_ALREADY_EXISTS",
        message: "exists",
      });
      const req = createMockReq({
        body: { displayName: "A", email: "a@b.com", password: "password1" },
      });
      const res = createMockRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.body.code).toBe("EMAIL_ALREADY_EXISTS");
    });
  });

  describe("confirm", () => {
    test("returns 400 for invalid OTP", async () => {
      const req = createMockReq({
        body: { email: "a@b.com", otpCode: "12" },
      });
      const res = createMockRes();
      await authController.confirm(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.confirmSignUp).not.toHaveBeenCalled();
    });

    test("returns 200 on valid confirm", async () => {
      const req = createMockReq({
        body: { email: "a@b.com", otpCode: "123456" },
      });
      const res = createMockRes();
      await authController.confirm(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(cognitoAuth.confirmSignUp).toHaveBeenCalled();
    });
  });

  describe("login", () => {
    test("returns 400 when password missing", async () => {
      const req = createMockReq({ body: { email: "a@b.com" } });
      const res = createMockRes();
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.signInWithPassword).not.toHaveBeenCalled();
    });

    test("returns 200 on successful login", async () => {
      cognitoAuth.signInWithPassword.mockResolvedValue({
        accessToken: "at",
        expiresIn: 3600,
      });
      const req = createMockReq({
        body: { email: "a@b.com", password: "password1" },
      });
      const res = createMockRes();
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    });
  });

  describe("refresh", () => {
    test("returns 400 when refreshToken missing", async () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      await authController.refresh(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("resendConfirmation", () => {
    test("returns 400 when email missing", async () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      await authController.resendConfirmation(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.resendConfirmationCode).not.toHaveBeenCalled();
    });
  });

  describe("updateProfile", () => {
    test("returns 400 for invalid dateOfBirth format", async () => {
      const req = createMockReq({
        user: { _id: "u1" },
        body: { dateOfBirth: "01-01-1990" },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateUserProfile).not.toHaveBeenCalled();
    });

    test("returns 400 for future dateOfBirth", async () => {
      const req = createMockReq({
        user: { _id: "u1" },
        body: { dateOfBirth: "2999-01-01" },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 for invalid gender", async () => {
      const req = createMockReq({
        user: { _id: "u1" },
        body: { gender: "UNKNOWN" },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 when no updatable fields provided", async () => {
      const req = createMockReq({ user: { _id: "u1" }, body: {} });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("updates profile for valid gender", async () => {
      const req = createMockReq({
        user: { _id: "u1" },
        body: { gender: "MALE" },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateUserProfile).toHaveBeenCalledWith("u1", { gender: "MALE" });
    });

    test("returns 400 when profilePic URL is not our media", async () => {
      isOurPublicMediaUrl.mockReturnValue(false);
      const req = createMockReq({
        user: { _id: "u1" },
        body: { profilePic: "https://evil.com/x.jpg" },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 when fullName empty", async () => {
      const req = createMockReq({
        user: { _id: "u1" },
        body: { fullName: "   " },
      });
      const res = createMockRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("forgotPassword", () => {
    test("returns 400 when email missing", async () => {
      const res = createMockRes();
      await authController.forgotPassword(createMockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 200 even when user not found", async () => {
      cognitoAuth.forgotPassword.mockRejectedValue({
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
      const res = createMockRes();
      await authController.forgotPassword(
        createMockReq({ body: { email: "a@b.com" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body).toEqual({ sent: true });
    });
  });

  describe("resetPassword", () => {
    test("returns 400 for invalid OTP", async () => {
      const res = createMockRes();
      await authController.resetPassword(
        createMockReq({
          body: { email: "a@b.com", otpCode: "12", newPassword: "password1" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(cognitoAuth.confirmForgotPassword).not.toHaveBeenCalled();
    });

    test("returns 400 when new password too short", async () => {
      const res = createMockRes();
      await authController.resetPassword(
        createMockReq({
          body: { email: "a@b.com", otpCode: "123456", newPassword: "short" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("changePassword", () => {
    test("returns 401 without accessToken", async () => {
      const res = createMockRes();
      await authController.changePassword(createMockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test("returns 400 when passwords match", async () => {
      const res = createMockRes();
      await authController.changePassword(
        createMockReq({
          accessToken: "at",
          body: { currentPassword: "same1234", newPassword: "same1234" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("logout", () => {
    test("returns 401 without accessToken", async () => {
      const res = createMockRes();
      await authController.logout(createMockReq({}), res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test("returns 200 on logout", async () => {
      const res = createMockRes();
      await authController.logout(
        createMockReq({ accessToken: "at", body: { refreshToken: "rt" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(cognitoAuth.revokeRefreshToken).toHaveBeenCalled();
    });
  });

  describe("checkAuth", () => {
    test("returns req.user", async () => {
      const user = { _id: "u1", fullName: "A" };
      const res = createMockRes();
      await authController.checkAuth(createMockReq({ user }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body).toEqual(user);
    });
  });

  describe("requestEmailChange", () => {
    test("returns 400 when newEmail missing", async () => {
      const res = createMockRes();
      await authController.requestEmailChange(
        createMockReq({ user: { _id: "u1", email: "a@b.com" }, body: {} }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("confirmEmailChange", () => {
    test("returns 400 when token missing", async () => {
      const res = createMockRes();
      await authController.confirmEmailChange(createMockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
