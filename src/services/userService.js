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
} = require("../lib/keys");

const TableName = () => getTableName();

function toPublicUser(item) {
  if (!item) return null;
  return {
    _id: item.userId,
    fullName: item.fullName,
    email: item.email,
    profilePic: item.avatarUrl || "",
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

async function updateProfileAvatar(userId, avatarUrl) {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: userPk(userId), SK: PROFILE_SK },
      UpdateExpression: "SET avatarUrl = :a, updatedAt = :u",
      ExpressionAttributeValues: { ":a": avatarUrl, ":u": now },
      ReturnValues: "ALL_NEW",
    }),
  );
  return getProfileRaw(userId);
}

module.exports = {
  toPublicUser,
  getProfileRaw,
  getUserByEmail,
  createUser,
  listProfilesExcept,
  updateProfileAvatar,
};
