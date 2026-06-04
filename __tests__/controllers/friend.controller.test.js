jest.mock("../../src/services/friendService");

const friendService = require("../../src/services/friendService");
const {
  postFriendRequest,
  getFriends,
} = require("../../src/controllers/friend.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("friend.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("postFriendRequest", () => {
    test("returns 400 for CANNOT_FRIEND_SELF", async () => {
      friendService.sendFriendRequest.mockRejectedValue({
        code: "CANNOT_FRIEND_SELF",
      });
      const res = createMockRes();
      await postFriendRequest(
        createMockReq({
          user: { _id: "u1" },
          body: { otherUserId: "u1" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.code).toBe("CANNOT_FRIEND_SELF");
    });

    test("returns 409 for ALREADY_FRIENDS", async () => {
      friendService.sendFriendRequest.mockRejectedValue({
        code: "ALREADY_FRIENDS",
      });
      const res = createMockRes();
      await postFriendRequest(
        createMockReq({
          user: { _id: "u1" },
          body: { otherUserId: "u2" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(409);
    });

    test("returns 409 for FRIEND_REQUEST_EXISTS", async () => {
      friendService.sendFriendRequest.mockRejectedValue({
        code: "FRIEND_REQUEST_EXISTS",
      });
      const res = createMockRes();
      await postFriendRequest(
        createMockReq({
          user: { _id: "u1" },
          body: { otherUserId: "u2" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(409);
    });

    test("returns 201 on success", async () => {
      friendService.sendFriendRequest.mockResolvedValue({
        otherUserId: "u2",
        status: "PENDING",
      });
      const res = createMockRes();
      await postFriendRequest(
        createMockReq({
          user: { _id: "u1" },
          body: { otherUserId: "u2" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("getFriends", () => {
    test("returns friend list", async () => {
      friendService.listFriends.mockResolvedValue([{ otherUserId: "u2" }]);
      const res = createMockRes();
      await getFriends(createMockReq({ user: { _id: "u1" } }), res);
      expect(res.json).toHaveBeenCalledWith([{ otherUserId: "u2" }]);
    });
  });
});
