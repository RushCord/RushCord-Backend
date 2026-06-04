const mockSend = jest.fn();

jest.mock("jsonwebtoken", () => ({
  decode: jest.fn((token) => {
    if (token === "id-token" || token === "access-token") {
      return { sub: "sub-from-jwt" };
    }
    return null;
  }),
}));

jest.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
  SignUpCommand: jest.fn((input) => ({ input, _type: "SignUp" })),
  ConfirmSignUpCommand: jest.fn((input) => ({ input, _type: "ConfirmSignUp" })),
  ResendConfirmationCodeCommand: jest.fn((input) => ({ input })),
  InitiateAuthCommand: jest.fn((input) => ({ input, _type: "InitiateAuth" })),
  RevokeTokenCommand: jest.fn((input) => ({ input })),
  GlobalSignOutCommand: jest.fn((input) => ({ input })),
  ForgotPasswordCommand: jest.fn((input) => ({ input, _type: "ForgotPassword" })),
  ConfirmForgotPasswordCommand: jest.fn((input) => ({ input })),
  ChangePasswordCommand: jest.fn((input) => ({ input })),
  AdminUpdateUserAttributesCommand: jest.fn((input) => ({ input })),
}));

const ORIGINAL_ENV = process.env;

function cognitoError(name, message = name) {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("cognitoAuthService", () => {
  let cognitoAuth;

  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    process.env = {
      ...ORIGINAL_ENV,
      COGNITO_USER_POOL_ID: "pool-test",
      COGNITO_CLIENT_ID: "client-test",
      AWS_REGION: "ap-southeast-1",
    };
    cognitoAuth = require("../../src/services/cognitoAuthService");
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("signUp maps UsernameExistsException to 409", async () => {
    mockSend.mockRejectedValue(cognitoError("UsernameExistsException"));
    await expect(
      cognitoAuth.signUp({
        email: "a@b.com",
        password: "password1",
        displayName: "A",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
    });
  });

  test("signUp returns userSub on success", async () => {
    mockSend.mockResolvedValue({ UserSub: "sub-123" });
    const out = await cognitoAuth.signUp({
      email: "a@b.com",
      password: "password1",
      displayName: "A",
    });
    expect(out).toEqual({ userSub: "sub-123", pendingConfirmation: true });
  });

  test("confirmSignUp maps CodeMismatchException to INVALID_OTP", async () => {
    mockSend.mockRejectedValue(cognitoError("CodeMismatchException"));
    await expect(
      cognitoAuth.confirmSignUp({ email: "a@b.com", otpCode: "123456" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_OTP",
    });
  });

  test("signInWithPassword maps UserNotConfirmedException", async () => {
    mockSend.mockRejectedValue(cognitoError("UserNotConfirmedException"));
    await expect(
      cognitoAuth.signInWithPassword({ email: "a@b.com", password: "password1" }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "USER_NOT_CONFIRMED",
    });
  });

  test("refreshSession maps NotAuthorizedException", async () => {
    mockSend.mockRejectedValue(cognitoError("NotAuthorizedException"));
    await expect(
      cognitoAuth.refreshSession({ refreshToken: "rt-1" }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "SESSION_EXPIRED",
    });
  });

  test("forgotPassword maps UserNotFoundException", async () => {
    mockSend.mockRejectedValue(cognitoError("UserNotFoundException"));
    await expect(
      cognitoAuth.forgotPassword({ email: "a@b.com" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "USER_NOT_FOUND",
    });
  });

  test("signUp maps InvalidPasswordException to 400", async () => {
    mockSend.mockRejectedValue(cognitoError("InvalidPasswordException"));
    await expect(
      cognitoAuth.signUp({
        email: "a@b.com",
        password: "weak",
        displayName: "A",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
  });

  test("signUp maps TooManyRequestsException to 429", async () => {
    mockSend.mockRejectedValue(cognitoError("TooManyRequestsException"));
    await expect(
      cognitoAuth.signUp({
        email: "a@b.com",
        password: "password1",
        displayName: "A",
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "RATE_LIMITED",
    });
  });

  test("signInWithPassword maps NotAuthorizedException", async () => {
    mockSend.mockRejectedValue(cognitoError("NotAuthorizedException"));
    await expect(
      cognitoAuth.signInWithPassword({ email: "a@b.com", password: "wrong" }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  test("signInWithPassword returns tokens on success", async () => {
    mockSend.mockResolvedValue({
      AuthenticationResult: {
        AccessToken: "access-token",
        ExpiresIn: 3600,
        IdToken: "id-token",
        RefreshToken: "refresh-token",
      },
    });

    const out = await cognitoAuth.signInWithPassword({
      email: "a@b.com",
      password: "password1",
    });
    expect(out.accessToken).toBe("access-token");
    expect(out.userSub).toBe("sub-from-jwt");
    expect(out.tokenType).toBe("Bearer");
  });

  test("refreshSession returns tokens on success", async () => {
    mockSend.mockResolvedValue({
      AuthenticationResult: {
        AccessToken: "access-token",
        ExpiresIn: 3600,
        IdToken: "id-token",
      },
    });

    const out = await cognitoAuth.refreshSession({ refreshToken: "rt-1" });
    expect(out.accessToken).toBe("access-token");
    expect(out.userSub).toBe("sub-from-jwt");
  });

  test("changePassword maps NotAuthorizedException", async () => {
    mockSend.mockRejectedValue(cognitoError("NotAuthorizedException"));
    await expect(
      cognitoAuth.changePassword({
        accessToken: "at",
        currentPassword: "old",
        newPassword: "newpass12",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CURRENT_PASSWORD",
    });
  });

  test("confirmForgotPassword maps ExpiredCodeException", async () => {
    mockSend.mockRejectedValue(cognitoError("ExpiredCodeException"));
    await expect(
      cognitoAuth.confirmForgotPassword({
        email: "a@b.com",
        otpCode: "123456",
        newPassword: "newpass12",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "OTP_EXPIRED",
    });
  });

  test("resendConfirmationCode maps UserNotFoundException", async () => {
    mockSend.mockRejectedValue(cognitoError("UserNotFoundException"));
    await expect(
      cognitoAuth.resendConfirmationCode({ email: "a@b.com" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "USER_NOT_FOUND",
    });
  });
});
