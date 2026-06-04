const mockDocSend = jest.fn();

jest.mock("../../src/lib/dynamodb", () => ({
  docClient: { send: mockDocSend },
  getTableName: jest.fn(() => "RushCordTest"),
}));

const { createSendQueue } = require("../helpers/mockDynamodb");
const {
  getConversationMember,
  assertUserInConversation,
} = require("../../src/services/conversationService");

describe("conversationService", () => {
  let q;

  beforeEach(() => {
    q = createSendQueue(mockDocSend);
  });

  test("getConversationMember returns item", async () => {
    const member = { userId: "u1", role: "MEMBER", status: "ACCEPTED" };
    q.pushGet(member);
    const out = await getConversationMember({
      conversationId: "GROUP#g1",
      userId: "u1",
    });
    expect(out).toEqual(member);
  });

  test("assertUserInConversation throws NOT_IN_CONVERSATION", async () => {
    q.pushGet(null);
    await expect(
      assertUserInConversation({ conversationId: "GROUP#g1", userId: "u1" }),
    ).rejects.toMatchObject({ code: "NOT_IN_CONVERSATION" });
  });

  test("assertUserInConversation throws CONVERSATION_NOT_ACCEPTED", async () => {
    q.pushGet({ userId: "u1", status: "PENDING" });
    await expect(
      assertUserInConversation({ conversationId: "GROUP#g1", userId: "u1" }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_ACCEPTED" });
  });

  test("assertUserInConversation returns accepted member", async () => {
    const member = { userId: "u1", status: "ACCEPTED", role: "MEMBER" };
    q.pushGet(member);
    const out = await assertUserInConversation({
      conversationId: "GROUP#g1",
      userId: "u1",
    });
    expect(out).toEqual(member);
  });
});
