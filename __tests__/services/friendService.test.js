const mockDocSend = jest.fn();

jest.mock("../../src/lib/dynamodb", () => ({
  docClient: { send: mockDocSend },
  getTableName: jest.fn(() => "RushCordTest"),
}));

const { createSendQueue } = require("../helpers/mockDynamodb");
const {
  sendFriendRequest,
  assertFriends,
  listFriends,
} = require("../../src/services/friendService");

describe("friendService", () => {
  let q;

  beforeEach(() => {
    q = createSendQueue(mockDocSend);
  });

  test("sendFriendRequest throws CANNOT_FRIEND_SELF", async () => {
    await expect(
      sendFriendRequest({ userId: "u1", otherUserId: "u1" }),
    ).rejects.toMatchObject({ code: "CANNOT_FRIEND_SELF" });
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  test("assertFriends throws NOT_FRIENDS", async () => {
    q.pushGet(null);
    await expect(
      assertFriends({ userIdA: "u1", userIdB: "u2" }),
    ).rejects.toMatchObject({ code: "NOT_FRIENDS" });
  });

  test("listFriends returns mapped items", async () => {
    q.pushQuery([
      { otherUserId: "u2", createdAt: "2020-01-01" },
      { otherUserId: "u3", createdAt: "2020-01-02" },
    ]);
    const out = await listFriends("u1");
    expect(out).toHaveLength(2);
    expect(out[0].otherUserId).toBe("u2");
  });
});
