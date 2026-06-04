jest.mock("../../src/lib/socket", () => ({
  io: { to: jest.fn(() => ({ emit: jest.fn() })) },
  getReceiverSocketId: jest.fn(),
}));
jest.mock("../../src/services/groupInviteService");
jest.mock("../../src/services/conversationService");
jest.mock("../../src/services/messageService");
jest.mock("../../src/controllers/conversationMessage.controller", () => ({
  emitGroupNewMessage: jest.fn(),
}));

const groupInviteService = require("../../src/services/groupInviteService");
const conversationService = require("../../src/services/conversationService");
const {
  getInvitePreviewHandler,
  createInviteHandler,
} = require("../../src/controllers/invite.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("invite.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getInvitePreviewHandler", () => {
    test("returns 404 for INVITE_NOT_FOUND", async () => {
      groupInviteService.getInvitePreview.mockRejectedValue({
        code: "INVITE_NOT_FOUND",
      });
      const res = createMockRes();
      await getInvitePreviewHandler(
        createMockReq({ params: { code: "badcode" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("returns 410 for INVITE_REVOKED", async () => {
      groupInviteService.getInvitePreview.mockRejectedValue({
        code: "INVITE_REVOKED",
      });
      const res = createMockRes();
      await getInvitePreviewHandler(
        createMockReq({ params: { code: "code1" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(410);
    });

    test("returns 200 with preview", async () => {
      groupInviteService.getInvitePreview.mockResolvedValue({
        title: "Group",
        canJoin: true,
        status: "valid",
      });
      const res = createMockRes();
      await getInvitePreviewHandler(
        createMockReq({ params: { code: "code1" } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body.title).toBe("Group");
    });
  });

  describe("createInviteHandler", () => {
    test("returns 403 when not owner or admin", async () => {
      conversationService.assertUserInConversation.mockResolvedValue({
        userId: "u1",
        role: "MEMBER",
      });
      const res = createMockRes();
      await createInviteHandler(
        createMockReq({
          user: { _id: "u1" },
          params: { conversationId: "GROUP#g1" },
          body: {},
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(groupInviteService.createGroupInvite).not.toHaveBeenCalled();
    });
  });
});
