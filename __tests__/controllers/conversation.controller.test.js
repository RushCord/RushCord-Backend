jest.mock("../../src/lib/socket", () => ({
  io: { to: jest.fn(() => ({ emit: jest.fn() })) },
  getReceiverSocketId: jest.fn(),
}));
jest.mock("../../src/services/conversationsService");
jest.mock("../../src/services/conversationService");
jest.mock("../../src/services/messageService");
jest.mock("../../src/controllers/conversationMessage.controller", () => ({
  emitGroupNewMessage: jest.fn(),
}));

const conversationsService = require("../../src/services/conversationsService");
const {
  createConversation,
  listConversations,
} = require("../../src/controllers/conversation.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("conversation.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createConversation", () => {
    test("returns 400 for INVALID_TITLE", async () => {
      conversationsService.createGroupConversation.mockRejectedValue({
        code: "INVALID_TITLE",
      });
      const res = createMockRes();
      await createConversation(
        createMockReq({
          user: { _id: "u1" },
          body: { title: "" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 for INVALID_TOPIC", async () => {
      conversationsService.createGroupConversation.mockRejectedValue({
        code: "INVALID_TOPIC",
      });
      const res = createMockRes();
      await createConversation(
        createMockReq({
          user: { _id: "u1" },
          body: { title: "G", topic: "bad" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 for INVALID_DESCRIPTION", async () => {
      conversationsService.createGroupConversation.mockRejectedValue({
        code: "INVALID_DESCRIPTION",
      });
      const res = createMockRes();
      await createConversation(
        createMockReq({
          user: { _id: "u1" },
          body: { title: "G", description: "x".repeat(300) },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 201 on success", async () => {
      conversationsService.createGroupConversation.mockResolvedValue({
        conversationId: "GROUP#g1",
        type: "GROUP",
        title: "My Group",
        topic: "",
        description: "",
        avatar: "",
        cover: "",
        createdAt: "2020-01-01T00:00:00.000Z",
        createdBy: "u1",
        memberCount: 1,
      });
      const res = createMockRes();
      await createConversation(
        createMockReq({
          user: { _id: "u1" },
          body: { title: "My Group" },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.conversationId).toBe("GROUP#g1");
    });
  });

  describe("listConversations", () => {
    test("returns 200 with items", async () => {
      conversationsService.listUserConversations.mockResolvedValue([
        { conversationId: "DM#a#b" },
      ]);
      const res = createMockRes();
      await listConversations(createMockReq({ user: { _id: "u1" } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
