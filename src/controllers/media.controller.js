const {
  DEFAULT_MAX_BYTES,
  buildObjectKey,
  buildPublicUrl,
  createPresignedPut,
  isAllowedMessageMime,
  getMaxUploadBytesForContentType,
  listAllowedMimes,
  getBucket,
} = require("../lib/s3Media");

async function presignedUpload(req, res) {
  try {
    if (!getBucket()) {
      return res.status(503).json({ message: "Media storage is not configured" });
    }

    const userId = req.user._id;
    const { purpose, fileName, contentType, contentLength } = req.body ?? {};

    if (purpose !== "avatar" && purpose !== "cover" && purpose !== "message") {
      return res.status(400).json({ message: "purpose must be avatar, cover, or message" });
    }

    const ct = String(contentType || "").trim();
    if (!ct) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "contentType is required",
      });
    }

    const len = Number(contentLength);
    if (!Number.isInteger(len) || len < 1) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "contentLength must be a positive integer",
      });
    }

    if (purpose === "avatar" || purpose === "cover") {
      if (!ct.startsWith("image/")) {
        return res.status(400).json({
          code: "UNSUPPORTED_CONTENT_TYPE",
          message: "Avatar and cover must be an image type",
        });
      }
      const maxBytes = getMaxUploadBytesForContentType(ct);
      if (len > maxBytes) {
        return res.status(400).json({
          code: "FILE_TOO_LARGE",
          message: `File too large (max ${Math.ceil(maxBytes / (1024 * 1024))} MB)`,
          maxBytes,
        });
      }
    } else {
      if (!isAllowedMessageMime(ct)) {
        return res.status(400).json({
          code: "UNSUPPORTED_CONTENT_TYPE",
          message: "Unsupported content type",
          allowedTypes: listAllowedMimes(),
        });
      }
      const maxBytes = getMaxUploadBytesForContentType(ct) ?? DEFAULT_MAX_BYTES;
      if (len > maxBytes) {
        return res.status(400).json({
          code: "FILE_TOO_LARGE",
          message: `File too large (max ${Math.ceil(maxBytes / (1024 * 1024))} MB)`,
          maxBytes,
        });
      }
    }

    const fn = fileName != null ? String(fileName) : "file";
    const key = buildObjectKey({
      purpose,
      userId,
      fileName: fn,
      contentType: ct,
    });

    const expiresRaw = process.env.S3_PRESIGN_EXPIRES_SECONDS;
    const expiresInSeconds =
      expiresRaw !== undefined && expiresRaw !== ""
        ? Math.min(604800, Math.max(60, parseInt(expiresRaw, 10) || 900))
        : 900;

    const { uploadUrl, expiresAt } = await createPresignedPut({
      key,
      contentType: ct,
      contentLength: len,
      expiresInSeconds,
    });

    res.status(200).json({
      uploadUrl,
      publicUrl: buildPublicUrl(key),
      key,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("presignedUpload:", err);
    res.status(500).json({ message: "Could not create upload URL" });
  }
}

module.exports = {
  presignedUpload,
};
