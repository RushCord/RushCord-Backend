jest.mock("../../src/services/conversationService");
jest.mock("../../src/services/channelsService");

const conversationService = require("../../src/services/conversationService");
const channelsService = require("../../src/services/channelsService");
const {
  listChannelsHandler,
  createChannelHandler,
} = require("../../src/controllers/channel.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("channel.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("listChannelsHandler returns 403 when not in conversation", async () => {
    conversationService.assertUserInConversation.mockRejectedValue({
      code: "NOT_IN_CONVERSATION",
    });
    const res = createMockRes();
    await listChannelsHandler(
      createMockReq({
        user: { _id: "u1" },
        params: { conversationId: "GROUP#g1" },
      }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("createChannelHandler returns 400 for INVALID_CHANNEL_TYPE", async () => {
    conversationService.assertUserInConversation.mockResolvedValue({
      userId: "u1",
      role: "OWNER",
    });
    channelsService.createChannel.mockRejectedValue({
      code: "INVALID_CHANNEL_TYPE",
    });
    const res = createMockRes();
    await createChannelHandler(
      createMockReq({
        user: { _id: "u1" },
        params: { conversationId: "GROUP#g1" },
        body: { channelType: "BAD", name: "x" },
      }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("createChannelHandler returns 403 for NOT_ALLOWED", async () => {
    conversationService.assertUserInConversation.mockResolvedValue({
      userId: "u1",
      role: "MEMBER",
    });
    channelsService.createChannel.mockRejectedValue({
      code: "NOT_ALLOWED",
    });
    const res = createMockRes();
    await createChannelHandler(
      createMockReq({
        user: { _id: "u1" },
        params: { conversationId: "GROUP#g1" },
        body: { channelType: "CHAT", name: "general" },
      }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
