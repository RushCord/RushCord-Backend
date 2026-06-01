const crypto = require("crypto");
const {
  GetCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  userPk,
  EMAIL_CHANGE_SK,
  emailChangeTokenPk,
  META_SK,
} = require("../lib/keys");
const { getUserByEmail, commitEmailChange } = require("./userService");
const cognitoAuth = require("./cognitoAuthService");
const { sendEmailChangeConfirmation } = require("../lib/sesMail");

const TableName = () => getTableName();

function throwHttp(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function frontendBaseUrl() {
  const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
  return base.replace(/\/+$/, "");
}

function ttlHours() {
  const h = parseInt(process.env.EMAIL_CHANGE_TTL_HOURS || "24", 10);
  return Number.isFinite(h) && h > 0 ? h : 24;
}

function expiresAtIso() {
  return new Date(Date.now() + ttlHours() * 60 * 60 * 1000).toISOString();
}

function isExpired(iso) {
  return new Date(iso).getTime() <= Date.now();
}

async function getPendingForUser(userSub) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: userPk(userSub), SK: EMAIL_CHANGE_SK },
    })
  );
  return res.Item || null;
}

async function deleteTokenLookup(tokenHash) {
  if (!tokenHash) return;
  await docClient.send(
    new DeleteCommand({
      TableName: TableName(),
      Key: { PK: emailChangeTokenPk(tokenHash), SK: META_SK },
    })
  );
}

async function savePending({ userSub, oldEmail, newEmail, tokenHash, expiresAt }) {
  const now = new Date().toISOString();
  const table = TableName();

  const existing = await getPendingForUser(userSub);
  if (existing?.tokenHash && existing.tokenHash !== tokenHash) {
    await deleteTokenLookup(existing.tokenHash);
  }

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: userPk(userSub),
        SK: EMAIL_CHANGE_SK,
        entityType: "EmailChangePending",
        userSub,
        oldEmail,
        newEmail,
        tokenHash,
        expiresAt,
        createdAt: now,
      },
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: emailChangeTokenPk(tokenHash),
        SK: META_SK,
        entityType: "EmailChangeToken",
        userSub,
        oldEmail,
        newEmail,
        expiresAt,
        createdAt: now,
      },
    })
  );
}

async function requestEmailChange({ userSub, oldEmail, newEmail, password }) {
  const normalizedOld = normalizeEmail(oldEmail);
  const normalizedNew = normalizeEmail(newEmail);

  if (!normalizedNew) {
    throwHttp(400, "VALIDATION_ERROR", "Email is required");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNew)) {
    throwHttp(400, "VALIDATION_ERROR", "Invalid email format");
  }
  if (normalizedNew === normalizedOld) {
    throwHttp(400, "VALIDATION_ERROR", "New email must be different from current email");
  }

  const taken = await getUserByEmail(normalizedNew);
  if (taken && taken.userId !== userSub) {
    throwHttp(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
  }

  try {
    await cognitoAuth.verifyPassword({ email: normalizedOld, password });
  } catch (err) {
    if (err.statusCode) throw err;
    throw err;
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = expiresAtIso();

  await savePending({
    userSub,
    oldEmail: normalizedOld,
    newEmail: normalizedNew,
    tokenHash,
    expiresAt,
  });

  const confirmUrl = `${frontendBaseUrl()}/confirm-email-change?token=${encodeURIComponent(token)}`;
  await sendEmailChangeConfirmation({
    toEmail: normalizedOld,
    confirmUrl,
  });

  return { sent: true };
}

async function confirmEmailChange({ token }) {
  const raw = String(token || "").trim();
  if (!raw) {
    throwHttp(400, "VALIDATION_ERROR", "Token is required");
  }

  const tokenHash = hashToken(raw);
  const lookup = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: emailChangeTokenPk(tokenHash), SK: META_SK },
    })
  );

  const meta = lookup.Item;
  if (!meta) {
    throwHttp(400, "INVALID_TOKEN", "Link is invalid or has already been used");
  }
  if (isExpired(meta.expiresAt)) {
    await deleteTokenLookup(tokenHash);
    const pending = await getPendingForUser(meta.userSub);
    if (pending?.tokenHash === tokenHash) {
      await docClient.send(
        new DeleteCommand({
          TableName: TableName(),
          Key: { PK: userPk(meta.userSub), SK: EMAIL_CHANGE_SK },
        })
      );
    }
    throwHttp(400, "TOKEN_EXPIRED", "Confirmation link has expired");
  }

  const { userSub, oldEmail, newEmail } = meta;

  const taken = await getUserByEmail(newEmail);
  if (taken && taken.userId !== userSub) {
    throwHttp(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
  }

  try {
    await cognitoAuth.adminUpdateUserEmail({ userSub, newEmail });
  } catch (err) {
    if (err.statusCode) throw err;
    throw err;
  }

  try {
    await commitEmailChange({
      userId: userSub,
      oldEmail,
      newEmail,
      tokenHash,
    });
  } catch (err) {
    try {
      await cognitoAuth.adminUpdateUserEmail({ userSub, newEmail: oldEmail });
    } catch (revertErr) {
      console.error("emailChange: failed to revert Cognito email after DDB error", revertErr);
    }
    if (err.code === "EMAIL_ALREADY_EXISTS") {
      throwHttp(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
    }
    throw err;
  }

  return { confirmed: true, email: newEmail };
}

module.exports = {
  requestEmailChange,
  confirmEmailChange,
};
