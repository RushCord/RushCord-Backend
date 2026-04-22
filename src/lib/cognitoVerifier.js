const jwt = require("jsonwebtoken");
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const { getCognitoConfig } = require("./cognitoConfig");

let verifier;

function shouldLogJwtVerifyDetails() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.COGNITO_JWT_DEBUG === "1" ||
    process.env.COGNITO_JWT_DEBUG === "true"
  );
}

function safeCognitoConfigSnapshot() {
  try {
    const c = getCognitoConfig();
    return { userPoolId: c.userPoolId, clientId: c.clientId, region: c.region };
  } catch (e) {
    return { loadError: e?.message || String(e) };
  }
}

function decodeTokenClaimsUnsafe(token) {
  try {
    const p = jwt.decode(token);
    if (!p || typeof p !== "object") return null;
    return {
      iss: p.iss,
      sub: p.sub,
      token_use: p.token_use,
      client_id: p.client_id,
      aud: p.aud,
      exp: p.exp,
      iat: p.iat,
    };
  } catch {
    return null;
  }
}

function logVerifyFailure(err, accessTokenJwt) {
  if (!shouldLogJwtVerifyDetails()) return;

  const tokenLen =
    typeof accessTokenJwt === "string" ? accessTokenJwt.length : 0;
  const claims = decodeTokenClaimsUnsafe(accessTokenJwt);

  const detail = {
    verifierErrorName: err?.name,
    verifierErrorMessage: err?.message,
    verifierErrorStack: err?.stack,
    /** aws-jwt-verify may attach extra fields */
    extra:
      err && typeof err === "object"
        ? Object.fromEntries(
            Object.entries(err).filter(
              ([k]) =>
                !["name", "message", "stack"].includes(k) &&
                typeof err[k] !== "function"
            )
          )
        : undefined,
    serverConfig: safeCognitoConfigSnapshot(),
    tokenLength: tokenLen,
    tokenClaimsDecoded: claims,
  };

  console.error("[CognitoJwtVerifier] verify() failed:", detail);
}

function getVerifier() {
  if (!verifier) {
    const { userPoolId, clientId } = getCognitoConfig();
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId,
      tokenUse: "access",
    });
  }
  return verifier;
}

/**
 * @param {string} accessTokenJwt
 * @returns {Promise<{ sub: string }>}
 */
async function verifyAccessToken(accessTokenJwt) {
  try {
    const payload = await getVerifier().verify(accessTokenJwt);
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub) {
      throw new Error("Invalid token subject");
    }
    return { sub };
  } catch (err) {
    // logVerifyFailure(err, accessTokenJwt);
    throw err;
  }
}

module.exports = { getVerifier, verifyAccessToken };
