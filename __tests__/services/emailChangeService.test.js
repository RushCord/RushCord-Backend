const mockDocSend = jest.fn();

jest.mock("../../src/lib/dynamodb", () => ({
  docClient: { send: mockDocSend },
  getTableName: jest.fn(() => "RushCordTest"),
}));
jest.mock("../../src/services/cognitoAuthService", () => ({
  verifyPassword: jest.fn(),
  adminUpdateUserEmail: jest.fn(),
}));
jest.mock("../../src/lib/sesMail", () => ({
  sendEmailChangeConfirmation: jest.fn(),
}));
jest.mock("../../src/services/userService", () => ({
  getUserByEmail: jest.fn(),
  commitEmailChange: jest.fn(),
}));

const cognitoAuth = require("../../src/services/cognitoAuthService");
const { getUserByEmail } = require("../../src/services/userService");
const { createSendQueue } = require("../helpers/mockDynamodb");
const {
  requestEmailChange,
  confirmEmailChange,
} = require("../../src/services/emailChangeService");

describe("emailChangeService", () => {
  let q;

  beforeEach(() => {
    jest.clearAllMocks();
    q = createSendQueue(mockDocSend);
    cognitoAuth.verifyPassword.mockResolvedValue(undefined);
    getUserByEmail.mockResolvedValue(null);
  });

  describe("requestEmailChange", () => {
    test("throws for invalid email format", async () => {
      await expect(
        requestEmailChange({
          userSub: "u1",
          oldEmail: "a@b.com",
          newEmail: "not-an-email",
          password: "pass",
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    });

    test("throws when new email equals old email", async () => {
      await expect(
        requestEmailChange({
          userSub: "u1",
          oldEmail: "a@b.com",
          newEmail: "a@b.com",
          password: "pass",
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    test("throws 409 when email already taken", async () => {
      getUserByEmail.mockResolvedValue({ userId: "other" });
      await expect(
        requestEmailChange({
          userSub: "u1",
          oldEmail: "a@b.com",
          newEmail: "taken@b.com",
          password: "pass",
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "EMAIL_ALREADY_EXISTS",
      });
    });
  });

  describe("confirmEmailChange", () => {
    test("throws when token empty", async () => {
      await expect(confirmEmailChange({ token: "" })).rejects.toMatchObject({
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    });

    test("throws INVALID_TOKEN when lookup missing", async () => {
      q.pushGet(null);
      await expect(
        confirmEmailChange({ token: "some-token-value" }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_TOKEN",
      });
    });
  });
});
