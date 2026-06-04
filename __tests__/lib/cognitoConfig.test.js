const ORIGINAL_ENV = process.env;

describe("getCognitoConfig", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("throws when pool or client id missing", () => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    const { getCognitoConfig } = require("../../src/lib/cognitoConfig");
    expect(() => getCognitoConfig()).toThrow(
      "Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID",
    );
  });

  test("returns config when env is set", () => {
    process.env.COGNITO_USER_POOL_ID = "pool-1";
    process.env.COGNITO_CLIENT_ID = "client-1";
    process.env.AWS_REGION = "us-east-1";
    const { getCognitoConfig } = require("../../src/lib/cognitoConfig");
    const cfg = getCognitoConfig();
    expect(cfg).toEqual({
      region: "us-east-1",
      userPoolId: "pool-1",
      clientId: "client-1",
      endpoint: undefined,
    });
  });

  test("uses default region when AWS_REGION unset", () => {
    process.env.COGNITO_USER_POOL_ID = "pool-1";
    process.env.COGNITO_CLIENT_ID = "client-1";
    delete process.env.AWS_REGION;
    const { getCognitoConfig } = require("../../src/lib/cognitoConfig");
    expect(getCognitoConfig().region).toBe("ap-southeast-1");
  });
});
