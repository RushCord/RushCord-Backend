const mockDocSend = jest.fn();

jest.mock("../../src/lib/dynamodb", () => ({
  docClient: { send: mockDocSend },
  getTableName: jest.fn(() => "RushCordTest"),
}));

const { createSendQueue } = require("../helpers/mockDynamodb");
const { getInvitePreview } = require("../../src/services/groupInviteService");

describe("groupInviteService getInvitePreview", () => {
  let q;

  beforeEach(() => {
    q = createSendQueue(mockDocSend);
  });

  test("throws INVITE_NOT_FOUND when lookup missing", async () => {
    q.pushGet(null);
    await expect(getInvitePreview("code1")).rejects.toMatchObject({
      code: "INVITE_NOT_FOUND",
    });
  });

  test("returns revoked status when invite revoked", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    q.pushGet({
      conversationId: "GROUP#g1",
      revoked: true,
      expiresAt: future,
      usesCount: 0,
    });
    q.pushGet({
      type: "GROUP",
      title: "Test Group",
      memberCount: 3,
      joinPolicy: "OPEN",
    });

    const preview = await getInvitePreview("code1");
    expect(preview.status).toBe("revoked");
    expect(preview.canJoin).toBe(false);
    expect(preview.title).toBe("Test Group");
  });

  test("returns valid preview when invite usable", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    q.pushGet({
      conversationId: "GROUP#g1",
      revoked: false,
      expiresAt: future,
      usesCount: 0,
      maxUses: null,
    });
    q.pushGet({
      type: "GROUP",
      title: "Open Group",
      memberCount: 5,
      joinPolicy: "OPEN",
    });

    const preview = await getInvitePreview("abc");
    expect(preview.status).toBe("valid");
    expect(preview.canJoin).toBe(true);
    expect(preview.title).toBe("Open Group");
  });

  test("returns expired status for past expiresAt", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    q.pushGet({
      conversationId: "GROUP#g1",
      revoked: false,
      expiresAt: past,
      usesCount: 0,
    });
    q.pushGet({
      type: "GROUP",
      title: "Old Group",
      memberCount: 1,
    });

    const preview = await getInvitePreview("code2");
    expect(preview.status).toBe("expired");
    expect(preview.canJoin).toBe(false);
  });
});
