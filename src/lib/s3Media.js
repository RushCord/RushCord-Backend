const path = require("path");
const { randomUUID } = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MB = 1024 * 1024;

function parseCsvSet(raw) {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
}

function parsePositiveInt(raw) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

let cachedPolicy;
function getMediaPolicy() {
  if (cachedPolicy) return cachedPolicy;

  const allowedMimes = parseCsvSet(process.env.MEDIA_ALLOWED_MIME);

  const imageMaxMb = parsePositiveInt(process.env.MEDIA_MAX_IMAGE_MB);
  const videoMaxMb = parsePositiveInt(process.env.MEDIA_MAX_VIDEO_MB);
  const docMaxMb = parsePositiveInt(process.env.MEDIA_MAX_DOC_MB);

  const maxImageBytes = (imageMaxMb ?? 5) * MB;
  const maxVideoBytes = (videoMaxMb ?? 100) * MB;
  const maxDocBytes = (docMaxMb ?? 20) * MB;

  // Fallback for environments that do not set MEDIA_ALLOWED_MIME.
  const defaultAllowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);

  const effectiveAllowed = allowedMimes.size > 0 ? allowedMimes : defaultAllowed;

  cachedPolicy = {
    allowedMimes: effectiveAllowed,
    maxBytesByContentType(contentType) {
      const ct = String(contentType || "").toLowerCase();
      if (ct.startsWith("image/")) return maxImageBytes;
      if (ct.startsWith("video/")) return maxVideoBytes;
      if (ct === "application/pdf") return maxDocBytes;
      if (ct === "application/msword") return maxDocBytes;
      if (
        ct ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
        return maxDocBytes;
      return DEFAULT_MAX_BYTES;
    },
    maxImageBytes,
    maxVideoBytes,
    maxDocBytes,
  };

  return cachedPolicy;
}

function getBucket() {
  return process.env.S3_BUCKET_NAME;
}

function getRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1";
}

let client;
function getClient() {
  if (!client) {
    client = new S3Client({ region: getRegion() });
  }
  return client;
}

function sanitizeOriginalFileName(name) {
  const base = path
    .basename(String(name || "file"))
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const trimmed = base.slice(0, 200);
  return trimmed || "file";
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };
  return map[m] || "";
}

function buildObjectKey({ purpose, userId, fileName, contentType }) {
  const safe = sanitizeOriginalFileName(fileName);
  const id = randomUUID();
  if (purpose === "avatar") {
    const ext = path.extname(safe) || extFromMime(contentType) || ".jpg";
    return `avatars/${userId}/${id}${ext}`;
  }
  return `messages/${userId}/${id}-${safe}`;
}

function buildPublicUrl(key) {
  const bucket = getBucket();
  const region = getRegion();
  const encoded = String(key)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

function getPublicUrlPrefix() {
  const bucket = getBucket();
  if (!bucket) return "";
  return `https://${bucket}.s3.${getRegion()}.amazonaws.com/`;
}

function isOurPublicMediaUrl(url) {
  if (typeof url !== "string" || url.length > 4096) return false;
  if (!url.startsWith("https://")) return false;
  const prefix = getPublicUrlPrefix();
  if (!prefix) return false;
  return url.startsWith(prefix);
}

function publicUrlToKey(publicUrl) {
  if (!isOurPublicMediaUrl(publicUrl)) return null;
  const prefix = getPublicUrlPrefix();
  if (!prefix) return null;
  const raw = publicUrl.slice(prefix.length);
  if (!raw) return null;
  try {
    return raw
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s))
      .join("/");
  } catch {
    return null;
  }
}

async function createPresignedPut({
  key,
  contentType,
  contentLength,
  expiresInSeconds,
}) {
  const bucket = getBucket();
  if (!bucket) {
    throw new Error("S3_BUCKET_NAME is not configured");
  }
  const input = {
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  };
  const command = new PutObjectCommand(input);
  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
  });
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  return { uploadUrl, expiresAt };
}

async function deleteObjectByKey(key) {
  const bucket = getBucket();
  if (!bucket) {
    throw new Error("S3_BUCKET_NAME is not configured");
  }
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

function isAllowedMessageMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (!/^[\w][\w.+-]*\/[\w.+-]+$/.test(m)) return false;
  return getMediaPolicy().allowedMimes.has(m);
}

function getMaxUploadBytesForContentType(contentType) {
  return getMediaPolicy().maxBytesByContentType(contentType);
}

function listAllowedMimes() {
  return Array.from(getMediaPolicy().allowedMimes.values()).sort();
}

module.exports = {
  DEFAULT_MAX_BYTES,
  buildObjectKey,
  buildPublicUrl,
  getPublicUrlPrefix,
  isOurPublicMediaUrl,
  publicUrlToKey,
  createPresignedPut,
  deleteObjectByKey,
  isAllowedMessageMime,
  getMaxUploadBytesForContentType,
  listAllowedMimes,
  getBucket,
  getRegion,
};
