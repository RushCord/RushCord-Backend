const { verifyAccessToken } = require("../lib/cognitoVerifier");
const { getProfileRaw, toPublicUser } = require("../services/userService");

function parseBearerToken(req) {
  const raw = req.headers.authorization;
  if (raw === undefined || typeof raw !== "string") {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match?.[1]?.trim()) {
    return null;
  }
  return match[1].trim();
}

/**
 * Verifies Cognito access JWT only (no DynamoDB). Sets req.cognitoSub, req.accessToken.
 */
async function authenticateAccessToken(req, res, next) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return res.status(401).json({
        message: "Missing or invalid Authorization header",
        code: "UNAUTHENTICATED",
      });
    }
    const { sub } = await verifyAccessToken(token);
    req.cognitoSub = sub;
    req.accessToken = token;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired access token",
      code: "UNAUTHENTICATED",
    });
  }
}

/**
 * Bearer access token + load RushCord profile (userId = Cognito sub).
 */
async function protectRoute(req, res, next) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "UNAUTHENTICATED",
      });
    }
    const { sub } = await verifyAccessToken(token);
    const profile = await getProfileRaw(sub);
    if (!profile) {
      return res.status(401).json({
        message:
          "User profile not found. Wait a moment after email verification, then try again.",
        code: "PROFILE_NOT_READY",
      });
    }
    req.user = toPublicUser(profile);
    req.cognitoSub = sub;
    req.accessToken = token;
    next();
  } catch {
    return res.status(401).json({
      message: "Unauthorized - Invalid or expired token",
      code: "UNAUTHENTICATED",
    });
  }
}

module.exports = {
  protectRoute,
  authenticateAccessToken,
};
