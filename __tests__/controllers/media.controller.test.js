jest.mock("../../src/lib/s3Media", () => ({
  DEFAULT_MAX_BYTES: 10 * 1024 * 1024,
  buildObjectKey: jest.fn(() => "messages/u1/key"),
  buildPublicUrl: jest.fn(() => "https://bucket.s3.region.amazonaws.com/messages/u1/key"),
  createPresignedPut: jest.fn(),
  isAllowedMessageMime: jest.fn(() => true),
  getMaxUploadBytesForContentType: jest.fn(() => 5 * 1024 * 1024),
  listAllowedMimes: jest.fn(() => ["image/jpeg"]),
  getBucket: jest.fn(),
}));

const s3Media = require("../../src/lib/s3Media");
const { presignedUpload } = require("../../src/controllers/media.controller");
const { createMockReq, createMockRes } = require("../helpers/mockReqRes");

describe("media.controller presignedUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    s3Media.getBucket.mockReturnValue("test-bucket");
    s3Media.createPresignedPut.mockResolvedValue({
      uploadUrl: "https://upload",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
  });

  test("returns 503 when bucket not configured", async () => {
    s3Media.getBucket.mockReturnValue("");
    const req = createMockReq({ user: { _id: "u1" }, body: {} });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test("returns 400 for invalid purpose", async () => {
    const req = createMockReq({
      user: { _id: "u1" },
      body: { purpose: "other", contentType: "image/jpeg", contentLength: 100 },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Media.createPresignedPut).not.toHaveBeenCalled();
  });

  test("returns 400 when contentType missing", async () => {
    const req = createMockReq({
      user: { _id: "u1" },
      body: { purpose: "message", contentLength: 100 },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  test("returns 400 when contentLength invalid", async () => {
    const req = createMockReq({
      user: { _id: "u1" },
      body: { purpose: "message", contentType: "image/jpeg", contentLength: 0 },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns 200 with presigned payload on success", async () => {
    const req = createMockReq({
      user: { _id: "u1" },
      body: {
        purpose: "avatar",
        contentType: "image/png",
        contentLength: 1024,
        fileName: "pic.png",
      },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(s3Media.createPresignedPut).toHaveBeenCalled();
    expect(res.body.uploadUrl).toBe("https://upload");
    expect(res.body.key).toBe("messages/u1/key");
  });

  test("returns UNSUPPORTED_CONTENT_TYPE for disallowed message mime", async () => {
    s3Media.isAllowedMessageMime.mockReturnValue(false);
    const req = createMockReq({
      user: { _id: "u1" },
      body: {
        purpose: "message",
        contentType: "application/x-bad",
        contentLength: 100,
      },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  test("returns FILE_TOO_LARGE when contentLength exceeds max", async () => {
    s3Media.isAllowedMessageMime.mockReturnValue(true);
    s3Media.getMaxUploadBytesForContentType.mockReturnValue(100);
    const req = createMockReq({
      user: { _id: "u1" },
      body: {
        purpose: "message",
        contentType: "image/jpeg",
        contentLength: 500,
      },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
  });

  test("returns 400 when cover is not an image type", async () => {
    const req = createMockReq({
      user: { _id: "u1" },
      body: {
        purpose: "cover",
        contentType: "text/plain",
        contentLength: 100,
      },
    });
    const res = createMockRes();
    await presignedUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });
});
