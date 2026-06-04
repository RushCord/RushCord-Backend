jest.mock("../../src/lib/socket", () => ({
  io: { to: jest.fn(() => ({ emit: jest.fn() })) },
  getReceiverSocketId: jest.fn(),
}));
jest.mock("../../src/services/messageService");
jest.mock("../../src/services/userService", () => ({
  listProfilesExcept: jest.fn(),
}));
jest.mock("../../src/lib/s3Media", () => ({
  isOurPublicMediaUrl: jest.fn(() => true),
}));

const messageService = require("../../src/services/messageService");
const { listProfilesExcept } = require("../../src/services/userService");
const {
  sendMessage,
  getMessages,
  getUsersForSideBar,
} = require("../../src/controllers/message.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("message.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendMessage", () => {
    test("returns 400 when body empty", async () => {
      const res = createMockRes();
      await sendMessage(
        createMockReq({
          user: { _id: "u1" },
          params: { id: "u2" },
          body: {},
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(messageService.sendDirectMessage).not.toHaveBeenCalled();
    });

    test("returns 400 when more than 5 images", async () => {
      const images = Array.from({ length: 6 }, (_, i) => ({
        fileUrl: `https://bucket.s3.region.amazonaws.com/messages/u1/f${i}.png`,
        s3Key: `messages/u1/f${i}.png`,
        mimeType: "image/png",
      }));
      const res = createMockRes();
      await sendMessage(
        createMockReq({
          user: { _id: "u1" },
          params: { id: "u2" },
          body: { images },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 when images and fileUrl together", async () => {
      const res = createMockRes();
      await sendMessage(
        createMockReq({
          user: { _id: "u1" },
          params: { id: "u2" },
          body: {
            images: [
              {
                fileUrl: "https://bucket.s3.region.amazonaws.com/messages/u1/a.png",
                s3Key: "messages/u1/a.png",
                mimeType: "image/png",
              },
            ],
            fileUrl: "https://bucket.s3.region.amazonaws.com/messages/u1/b.pdf",
          },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("getMessages", () => {
    test("returns 403 when not friends", async () => {
      messageService.listDirectMessages.mockRejectedValue({
        code: "NOT_FRIENDS",
      });
      const res = createMockRes();
      await getMessages(
        createMockReq({
          user: { _id: "u1" },
          params: { id: "u2" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.body.code).toBe("NOT_FRIENDS");
    });
  });

  describe("getUsersForSideBar", () => {
    test("returns 200 with user list", async () => {
      listProfilesExcept.mockResolvedValue([{ _id: "u2" }]);
      const res = createMockRes();
      await getUsersForSideBar(createMockReq({ user: { _id: "u1" } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body).toEqual([{ _id: "u2" }]);
    });
  });
});
