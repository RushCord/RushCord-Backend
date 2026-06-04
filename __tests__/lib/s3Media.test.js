const ORIGINAL_ENV = process.env;

function loadS3Media() {
  return require("../../src/lib/s3Media");
}

describe("s3Media", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      S3_BUCKET_NAME: "test-bucket",
      AWS_REGION: "ap-southeast-1",
    };
    delete process.env.MEDIA_ALLOWED_MIME;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test("buildObjectKey for avatar and cover", () => {
    const s3 = loadS3Media();
    const avatar = s3.buildObjectKey({
      purpose: "avatar",
      userId: "u1",
      fileName: "pic.png",
      contentType: "image/png",
    });
    expect(avatar).toMatch(/^avatars\/u1\/[0-9a-f-]+\.png$/);

    const cover = s3.buildObjectKey({
      purpose: "cover",
      userId: "u1",
      fileName: "cover.jpg",
      contentType: "image/jpeg",
    });
    expect(cover).toMatch(/^covers\/u1\/[0-9a-f-]+\.jpg$/);
  });

  test("buildObjectKey for messages", () => {
    const s3 = loadS3Media();
    const key = s3.buildObjectKey({
      purpose: "message",
      userId: "u1",
      fileName: "doc.pdf",
      contentType: "application/pdf",
    });
    expect(key).toMatch(/^messages\/u1\/[0-9a-f-]+-doc\.pdf$/);
  });

  test("buildPublicUrl and publicUrlToKey round-trip", () => {
    const s3 = loadS3Media();
    const key = "messages/u1/file name.pdf";
    const url = s3.buildPublicUrl(key);
    expect(url).toBe(
      "https://test-bucket.s3.ap-southeast-1.amazonaws.com/messages/u1/file%20name.pdf",
    );
    expect(s3.publicUrlToKey(url)).toBe(key);
  });

  test("isOurPublicMediaUrl rejects invalid urls", () => {
    const s3 = loadS3Media();
    expect(s3.isOurPublicMediaUrl("http://evil.com/x")).toBe(false);
    expect(s3.isOurPublicMediaUrl("not-a-url")).toBe(false);
    const valid = s3.buildPublicUrl("avatars/u1/x.jpg");
    expect(s3.isOurPublicMediaUrl(valid)).toBe(true);
  });

  test("isAllowedMessageMime", () => {
    const s3 = loadS3Media();
    expect(s3.isAllowedMessageMime("image/jpeg")).toBe(true);
    expect(s3.isAllowedMessageMime("not-a-mime")).toBe(false);
    expect(s3.isAllowedMessageMime("")).toBe(false);
  });

  test("getMaxUploadBytesForContentType by category", () => {
    const s3 = loadS3Media();
    expect(s3.getMaxUploadBytesForContentType("image/png")).toBe(5 * 1024 * 1024);
    expect(s3.getMaxUploadBytesForContentType("video/mp4")).toBe(100 * 1024 * 1024);
    expect(s3.getMaxUploadBytesForContentType("unknown/type")).toBe(
      s3.DEFAULT_MAX_BYTES,
    );
  });

  test("listAllowedMimes returns sorted list", () => {
    const s3 = loadS3Media();
    const list = s3.listAllowedMimes();
    expect(list.length).toBeGreaterThan(0);
    expect([...list]).toEqual([...list].sort());
  });

  test("createPresignedPut throws when bucket missing", async () => {
    delete process.env.S3_BUCKET_NAME;
    jest.resetModules();
    const s3 = loadS3Media();
    await expect(
      s3.createPresignedPut({
        key: "k",
        contentType: "image/png",
        contentLength: 100,
        expiresInSeconds: 900,
      }),
    ).rejects.toThrow("S3_BUCKET_NAME is not configured");
  });

  test("listAllowedMimes respects MEDIA_ALLOWED_MIME env", () => {
    process.env.MEDIA_ALLOWED_MIME = "image/png";
    jest.resetModules();
    const s3 = loadS3Media();
    expect(s3.listAllowedMimes()).toEqual(["image/png"]);
    expect(s3.isAllowedMessageMime("image/png")).toBe(true);
    expect(s3.isAllowedMessageMime("image/jpeg")).toBe(false);
  });
});
