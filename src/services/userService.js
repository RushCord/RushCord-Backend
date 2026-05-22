const { randomUUID } = require("crypto");
const {
  GetCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  userPk,
  PROFILE_SK,
  emailPk,
  EMAIL_REF_SK,
  EMAIL_CHANGE_SK,
  emailChangeTokenPk,
  META_SK,
} = require("../lib/keys");

const TableName = () => getTableName();

function toPublicUser(item) {
  if (!item) return null;
  return {
    _id: item.userId,
    fullName: item.fullName,
    email: item.email,
    profilePic: item.avatarUrl || "",
    coverPic: item.coverImageUrl || "",
    dateOfBirth: item.dateOfBirth || "",
    gender: item.gender || "",
    createdAt: item.createdAt || null,
  };
}

/** Public profile for other users (no email). */
function toPublicUserExplore(item) {
  if (!item) return null;
  return {
    _id: item.userId,
    fullName: item.fullName,
    profilePic: item.avatarUrl || "",
    coverPic: item.coverImageUrl || "",
    dateOfBirth: item.dateOfBirth || "",
    gender: item.gender || "",
    createdAt: item.createdAt || null,
  };
}

async function getProfileRaw(userId) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: userPk(userId), SK: PROFILE_SK },
    }),
  );
  return res.Item || null;
}

async function getUserByEmail(email) {
  const ref = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: emailPk(email), SK: EMAIL_REF_SK },
    }),
  );
  if (!ref.Item) return null;
  return getProfileRaw(ref.Item.userId);
}

async function createUser({ fullName, email, passwordHash }) {
  const userId = randomUUID();
  const now = new Date().toISOString();
  const profile = {
    PK: userPk(userId),
    SK: PROFILE_SK,
    entityType: "User",
    userId,
    fullName,
    email,
    avatarUrl: "",
    userName: email.split("@")[0],
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  const emailRef = {
    PK: emailPk(email),
    SK: EMAIL_REF_SK,
    entityType: "EmailRef",
    userId,
    email: email.trim().toLowerCase(),
  };

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TableName(),
              Item: profile,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: TableName(),
              Item: emailRef,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const err = new Error("EMAIL_EXISTS");
      err.code = "EMAIL_EXISTS";
      throw err;
    }
    throw e;
  }

  return getProfileRaw(userId);
}

async function listProfilesExcept(excludeUserId) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TableName(),
        FilterExpression: "SK = :sk AND userId <> :uid",
        ExpressionAttributeValues: {
          ":sk": PROFILE_SK,
          ":uid": excludeUserId,
        },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items || []) {
      out.push(toPublicUser(item));
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function searchUsersForExplore(excludeUserId, query, limit = 40) {
  const all = await listProfilesExcept(excludeUserId);
  const cap = Math.min(80, Math.max(1, Number(limit) || 40));
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return all
      .slice()
      .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")))
      .slice(0, cap);
  }
  return all
    .filter((u) => {
      const name = String(u.fullName || "").toLowerCase();
      const mail = String(u.email || "").toLowerCase();
      const id = String(u._id || "").toLowerCase();
      return name.includes(needle) || mail.includes(needle) || id.includes(needle);
    })
    .slice()
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")))
    .slice(0, cap);
}

const PROFILE_UPDATE_KEYS = new Set([
  "avatarUrl",
  "coverImageUrl",
  "fullName",
  "dateOfBirth",
  "gender",
]);

async function updateUserProfile(userId, updates) {
  const entries = Object.entries(updates).filter(
    ([k, v]) => PROFILE_UPDATE_KEYS.has(k) && v !== undefined,
  );
  if (entries.length === 0) {
    return getProfileRaw(userId);
  }
  const now = new Date().toISOString();
  const ExpressionAttributeValues = { ":u": now };
  const setFragments = entries.map(([key, value], i) => {
    const vk = `:v${i}`;
    ExpressionAttributeValues[vk] = value;
    return `${key} = ${vk}`;
  });
  setFragments.push("updatedAt = :u");
  const UpdateExpression = `SET ${setFragments.join(", ")}`;
  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: userPk(userId), SK: PROFILE_SK },
      UpdateExpression,
      ExpressionAttributeValues,
    }),
  );
  return getProfileRaw(userId);
}

async function commitEmailChange({ userId, oldEmail, newEmail, tokenHash }) {
  const normalizedOld = String(oldEmail).trim().toLowerCase();
  const normalizedNew = String(newEmail).trim().toLowerCase();
  const now = new Date().toISOString();
  const table = TableName();

  const emailRef = {
    PK: emailPk(normalizedNew),
    SK: EMAIL_REF_SK,
    entityType: "EmailRef",
    userId,
    email: normalizedNew,
  };

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: table,
              Key: { PK: userPk(userId), SK: PROFILE_SK },
              UpdateExpression: "SET email = :e, updatedAt = :u",
              ExpressionAttributeValues: {
                ":e": normalizedNew,
                ":u": now,
              },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Delete: {
              TableName: table,
              Key: { PK: emailPk(normalizedOld), SK: EMAIL_REF_SK },
            },
          },
          {
            Put: {
              TableName: table,
              Item: emailRef,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Delete: {
              TableName: table,
              Key: { PK: userPk(userId), SK: EMAIL_CHANGE_SK },
            },
          },
          {
            Delete: {
              TableName: table,
              Key: { PK: emailChangeTokenPk(tokenHash), SK: META_SK },
            },
          },
        ],
      })
    );
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const err = new Error("EMAIL_ALREADY_EXISTS");
      err.code = "EMAIL_ALREADY_EXISTS";
      throw err;
    }
    throw e;
  }

  return getProfileRaw(userId);
}

module.exports = {
  toPublicUser,
  toPublicUserExplore,
  getProfileRaw,
  getUserByEmail,
  createUser,
  listProfilesExcept,
  searchUsersForExplore,
  updateUserProfile,
  commitEmailChange,
};
