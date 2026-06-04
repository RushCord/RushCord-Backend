const mockDocSend = jest.fn();

jest.mock("../../src/lib/dynamodb", () => ({
  docClient: { send: mockDocSend },
  getTableName: jest.fn(() => "RushCordTest"),
}));

const { createSendQueue } = require("../helpers/mockDynamodb");
const { createChannel } = require("../../src/services/channelsService");

describe("channelsService createChannel", () => {
  let q;

  beforeEach(() => {
    q = createSendQueue(mockDocSend);
  });

  test("throws INVALID_CHANNEL_TYPE for unknown type", async () => {
    await expect(
      createChannel({
        conversationId: "GROUP#g1",
        actorMember: { userId: "u1", role: "OWNER" },
        channelType: "INVALID",
        name: "test",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHANNEL_TYPE" });
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  test("throws NOT_ALLOWED for member role", async () => {
    await expect(
      createChannel({
        conversationId: "GROUP#g1",
        actorMember: { userId: "u1", role: "MEMBER" },
        channelType: "CHAT",
        name: "general",
      }),
    ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  test("throws INVALID_NAME for empty name", async () => {
    q.pushGet({ type: "GROUP", conversationId: "GROUP#g1" });
    await expect(
      createChannel({
        conversationId: "GROUP#g1",
        actorMember: { userId: "u1", role: "OWNER" },
        channelType: "CHAT",
        name: "   ",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });
});
