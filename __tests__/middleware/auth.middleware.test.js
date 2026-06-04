jest.mock("../../src/lib/cognitoVerifier", () => ({
  verifyAccessToken: jest.fn(),
}));
jest.mock("../../src/services/userService", () => ({
  getProfileRaw: jest.fn(),
  toPublicUser: jest.fn((p) => ({ _id: p.userId, fullName: p.fullName })),
}));

const { verifyAccessToken } = require("../../src/lib/cognitoVerifier");
const { getProfileRaw } = require("../../src/services/userService");
const {
  authenticateAccessToken,
  protectRoute,
} = require("../../src/middleware/auth.middleware");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("auth.middleware", () => {
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  describe("authenticateAccessToken", () => {
    test("returns 401 when Authorization header missing", async () => {
      const req = createMockReq();
      const res = createMockRes();
      await authenticateAccessToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
      expect(next).not.toHaveBeenCalled();
    });

    test("calls next and sets cognitoSub when token valid", async () => {
      verifyAccessToken.mockResolvedValue({ sub: "user-1" });
      const req = createMockReq({
        headers: { authorization: "Bearer token-abc" },
      });
      const res = createMockRes();
      await authenticateAccessToken(req, res, next);
      expect(verifyAccessToken).toHaveBeenCalledWith("token-abc");
      expect(req.cognitoSub).toBe("user-1");
      expect(req.accessToken).toBe("token-abc");
      expect(next).toHaveBeenCalled();
    });

    test("returns 401 when verify fails", async () => {
      verifyAccessToken.mockRejectedValue(new Error("bad token"));
      const req = createMockReq({
        headers: { authorization: "Bearer bad" },
      });
      const res = createMockRes();
      await authenticateAccessToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("returns 401 when Bearer token is empty", async () => {
      const req = createMockReq({ headers: { authorization: "Bearer" } });
      const res = createMockRes();
      await authenticateAccessToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("protectRoute", () => {
    test("returns PROFILE_NOT_READY when profile missing", async () => {
      verifyAccessToken.mockResolvedValue({ sub: "user-1" });
      getProfileRaw.mockResolvedValue(null);
      const req = createMockReq({
        headers: { authorization: "Bearer token-abc" },
      });
      const res = createMockRes();
      await protectRoute(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body.code).toBe("PROFILE_NOT_READY");
      expect(next).not.toHaveBeenCalled();
    });

    test("sets req.user and calls next when profile exists", async () => {
      verifyAccessToken.mockResolvedValue({ sub: "user-1" });
      getProfileRaw.mockResolvedValue({ userId: "user-1", fullName: "Alice" });
      const req = createMockReq({
        headers: { authorization: "Bearer token-abc" },
      });
      const res = createMockRes();
      await protectRoute(req, res, next);
      expect(req.user).toEqual({ _id: "user-1", fullName: "Alice" });
      expect(next).toHaveBeenCalled();
    });

    test("returns 401 when verifyAccessToken throws in protectRoute", async () => {
      verifyAccessToken.mockRejectedValue(new Error("expired"));
      const req = createMockReq({
        headers: { authorization: "Bearer token-abc" },
      });
      const res = createMockRes();
      await protectRoute(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
