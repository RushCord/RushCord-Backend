const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((input) => ({ input })),
  DeleteObjectCommand: jest.fn((input) => ({ input })),
}));
jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://signed.example/upload"),
}));

const ORIGINAL_ENV = process.env;

describe("s3Media deleteObjectByKey", () => {
  beforeEach(() => {
    jest.resetModules();
    mockS3Send.mockReset();
    mockS3Send.mockResolvedValue({});
    process.env = {
      ...ORIGINAL_ENV,
      S3_BUCKET_NAME: "test-bucket",
      AWS_REGION: "ap-southeast-1",
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("deleteObjectByKey sends delete to S3", async () => {
    const s3 = require("../../src/lib/s3Media");
    await s3.deleteObjectByKey("messages/u1/file.png");
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });
});
