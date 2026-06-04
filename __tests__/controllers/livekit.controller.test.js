const mockToJwt = jest.fn().mockResolvedValue("jwt-token");
const mockAddGrant = jest.fn();

jest.mock("livekit-server-sdk", () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: mockAddGrant,
    toJwt: mockToJwt,
  })),
}));
jest.mock("../../src/services/conversationService", () => ({
  assertUserInConversation: jest.fn(),
}));

const { assertUserInConversation } = require("../../src/services/conversationService");
const { mintToken } = require("../../src/controllers/livekit.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("livekit.controller mintToken", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToJwt.mockResolvedValue("jwt-token");
    process.env = { ...ORIGINAL_ENV };
    assertUserInConversation.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("returns 400 when roomName missing", async () => {
    const req = createMockReq({ cognitoSub: "u1", body: {} });
    const res = createMockRes();
    await mintToken(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe("INVALID_INPUT");
    expect(assertUserInConversation).not.toHaveBeenCalled();
  });

  test("returns 500 when LiveKit env missing", async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
    const req = createMockReq({
      cognitoSub: "u1",
      body: { roomName: "DM#a#b" },
    });
    const res = createMockRes();
    await mintToken(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.code).toBe("SERVER_CONFIG_ERROR");
  });

  test("parses conversationId from voice roomName", async () => {
    delete process.env.LIVEKIT_API_KEY;
    const req = createMockReq({
      cognitoSub: "u1",
      body: { roomName: "GROUP#g1#VOICE#ch1" },
    });
    const res = createMockRes();
    await mintToken(req, res);
    expect(assertUserInConversation).toHaveBeenCalledWith({
      conversationId: "GROUP#g1",
      userId: "u1",
    });
  });

  test("returns 403 when not in conversation", async () => {
    assertUserInConversation.mockRejectedValue({
      code: "NOT_IN_CONVERSATION",
    });
    const req = createMockReq({
      cognitoSub: "u1",
      body: { roomName: "GROUP#g1" },
    });
    const res = createMockRes();
    await mintToken(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  test("returns url and token when configured", async () => {
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    process.env.LIVEKIT_URL = "wss://livekit.example";
    const res = createMockRes();
    await mintToken(
      createMockReq({ cognitoSub: "u1", body: { roomName: "GROUP#g1" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      url: "wss://livekit.example",
      token: "jwt-token",
    });
    expect(mockAddGrant).toHaveBeenCalled();
  });
});
