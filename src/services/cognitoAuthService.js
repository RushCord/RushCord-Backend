const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  RevokeTokenCommand,
  GlobalSignOutCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const jwt = require("jsonwebtoken");
const { getCognitoConfig } = require("../lib/cognitoConfig");

function cognitoClient() {
  const { region, endpoint } = getCognitoConfig();
  return new CognitoIdentityProviderClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
}

function clientId() {
  return getCognitoConfig().clientId;
}

function throwHttp(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

function decodeJwtSub(token) {
  if (!token || typeof token !== "string") return null;
  const payload = jwt.decode(token);
  return payload && typeof payload.sub === "string" ? payload.sub : null;
}

function toAuthTokensResult(ar) {
  const accessToken = ar.AccessToken;
  if (!accessToken) {
    throwHttp(502, "COGNITO_ERROR", "Access token missing from authentication result");
  }
  if (ar.ExpiresIn == null) {
    throwHttp(502, "COGNITO_ERROR", "ExpiresIn missing from authentication result");
  }
  const userSub =
    decodeJwtSub(ar.IdToken ?? "") ?? decodeJwtSub(accessToken);
  if (!userSub) {
    throwHttp(502, "COGNITO_ERROR", "Could not read user sub from tokens");
  }
  return {
    accessToken,
    ...(ar.IdToken ? { idToken: ar.IdToken } : {}),
    ...(ar.RefreshToken ? { refreshToken: ar.RefreshToken } : {}),
    expiresIn: ar.ExpiresIn,
    tokenType: "Bearer",
    userSub,
  };
}

function mapSignUpError(err) {
  const name = err?.name || "";
  if (name === "UsernameExistsException" || name === "AliasExistsException") {
    throwHttp(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
  }
  if (name === "InvalidPasswordException") {
    throwHttp(
      400,
      "VALIDATION_ERROR",
      err.message || "Password does not satisfy the user pool policy"
    );
  }
  if (name === "InvalidParameterException") {
    throwHttp(400, "VALIDATION_ERROR", err.message || "Invalid parameters");
  }
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

function mapConfirmError(err) {
  const name = err?.name || "";
  if (name === "CodeMismatchException") {
    throwHttp(400, "INVALID_OTP", "Invalid verification code");
  }
  if (name === "ExpiredCodeException") {
    throwHttp(400, "OTP_EXPIRED", "Verification code has expired");
  }
  if (name === "UserNotFoundException") {
    throwHttp(404, "USER_NOT_FOUND", "User not found");
  }
  if (name === "NotAuthorizedException") {
    throwHttp(400, "INVALID_REQUEST", err.message || "Not authorized");
  }
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

function mapResendError(err) {
  const name = err?.name || "";
  if (name === "UserNotFoundException") {
    throwHttp(404, "USER_NOT_FOUND", "User not found");
  }
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  if (name === "InvalidParameterException") {
    throwHttp(400, "VALIDATION_ERROR", err.message || "Invalid parameters");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

function mapLoginError(err) {
  const name = err?.name || "";
  if (name === "NotAuthorizedException") {
    throwHttp(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (name === "UserNotConfirmedException") {
    throwHttp(403, "USER_NOT_CONFIRMED", "Please verify your email before signing in");
  }
  if (name === "UserNotFoundException") {
    throwHttp(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  if (name === "InvalidParameterException") {
    throwHttp(400, "VALIDATION_ERROR", err.message || "Invalid parameters");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

function mapRefreshError(err) {
  const name = err?.name || "";
  if (name === "NotAuthorizedException") {
    throwHttp(401, "SESSION_EXPIRED", "Session expired. Please sign in again.");
  }
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

function mapRevokeOrGlobalSignOutError(err) {
  const name = err?.name || "";
  if (name === "TooManyRequestsException") {
    throwHttp(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }
  if (name === "NotAuthorizedException") {
    return;
  }
  if (name === "InvalidParameterException") {
    throwHttp(400, "VALIDATION_ERROR", err.message || "Invalid parameters");
  }
  throwHttp(502, "COGNITO_ERROR", err.message || "Cognito error");
}

async function signUp({ email, password, displayName }) {
  const normalized = String(email).trim().toLowerCase();
  try {
    const out = await cognitoClient().send(
      new SignUpCommand({
        ClientId: clientId(),
        Username: normalized,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: normalized },
          { Name: "name", Value: String(displayName).trim() },
        ],
      })
    );
    const userSub = out.UserSub;
    if (!userSub) {
      throwHttp(502, "COGNITO_ERROR", "SignUp succeeded but UserSub was missing");
    }
    return { userSub, pendingConfirmation: true };
  } catch (err) {
    if (err.statusCode) throw err;
    mapSignUpError(err);
  }
}

async function confirmSignUp({ email, otpCode }) {
  const normalized = String(email).trim().toLowerCase();
  try {
    await cognitoClient().send(
      new ConfirmSignUpCommand({
        ClientId: clientId(),
        Username: normalized,
        ConfirmationCode: String(otpCode).trim(),
      })
    );
  } catch (err) {
    if (err.statusCode) throw err;
    mapConfirmError(err);
  }
}

async function resendConfirmationCode({ email }) {
  const normalized = String(email).trim().toLowerCase();
  try {
    await cognitoClient().send(
      new ResendConfirmationCodeCommand({
        ClientId: clientId(),
        Username: normalized,
      })
    );
  } catch (err) {
    if (err.statusCode) throw err;
    mapResendError(err);
  }
}

async function signInWithPassword({ email, password }) {
  const normalized = String(email).trim().toLowerCase();
  try {
    const out = await cognitoClient().send(
      new InitiateAuthCommand({
        ClientId: clientId(),
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME: normalized,
          PASSWORD: password,
        },
      })
    );
    if (out.ChallengeName) {
      throwHttp(
        502,
        "COGNITO_ERROR",
        "Additional authentication challenge required"
      );
    }
    const ar = out.AuthenticationResult;
    if (!ar) {
      throwHttp(502, "COGNITO_ERROR", "Authentication returned no result");
    }
    return toAuthTokensResult(ar);
  } catch (err) {
    if (err.statusCode) throw err;
    mapLoginError(err);
  }
}

async function refreshSession({ refreshToken }) {
  try {
    const out = await cognitoClient().send(
      new InitiateAuthCommand({
        ClientId: clientId(),
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: {
          REFRESH_TOKEN: String(refreshToken).trim(),
        },
      })
    );
    const ar = out.AuthenticationResult;
    if (!ar) {
      throwHttp(502, "COGNITO_ERROR", "Refresh returned no authentication result");
    }
    return toAuthTokensResult(ar);
  } catch (err) {
    if (err.statusCode) throw err;
    mapRefreshError(err);
  }
}

async function revokeRefreshToken({ refreshToken }) {
  try {
    await cognitoClient().send(
      new RevokeTokenCommand({
        ClientId: clientId(),
        Token: String(refreshToken).trim(),
      })
    );
  } catch (err) {
    if (err.statusCode) throw err;
    mapRevokeOrGlobalSignOutError(err);
  }
}

async function globalSignOut({ accessToken }) {
  try {
    await cognitoClient().send(
      new GlobalSignOutCommand({
        AccessToken: accessToken,
      })
    );
  } catch (err) {
    if (err.statusCode) throw err;
    mapRevokeOrGlobalSignOutError(err);
  }
}

module.exports = {
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  signInWithPassword,
  refreshSession,
  revokeRefreshToken,
  globalSignOut,
};
