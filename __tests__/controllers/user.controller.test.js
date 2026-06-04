jest.mock("../../src/services/userService");

const userService = require("../../src/services/userService");
const { getUserPublic, searchUsers } = require("../../src/controllers/user.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("user.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getUserPublic", () => {
    test("returns 400 when userId missing", async () => {
      const res = createMockRes();
      await getUserPublic(
        createMockReq({ user: { _id: "u1" }, params: {} }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 404 when profile not found", async () => {
      userService.getProfileRaw.mockResolvedValue(null);
      const res = createMockRes();
      await getUserPublic(
        createMockReq({ user: { _id: "u1" }, params: { userId: "u2" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("returns isSelf for own profile", async () => {
      userService.getProfileRaw.mockResolvedValue({
        userId: "u1",
        fullName: "Me",
      });
      userService.toPublicUserExplore.mockReturnValue({
        _id: "u1",
        fullName: "Me",
      });
      const res = createMockRes();
      await getUserPublic(
        createMockReq({ user: { _id: "u1" }, params: { userId: "u1" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body.isSelf).toBe(true);
    });
  });

  describe("searchUsers", () => {
    test("returns search results", async () => {
      userService.searchUsersForExplore.mockResolvedValue([{ _id: "u2" }]);
      const res = createMockRes();
      await searchUsers(
        createMockReq({ user: { _id: "u1" }, query: { q: "ali" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body).toEqual([{ _id: "u2" }]);
    });
  });
});
