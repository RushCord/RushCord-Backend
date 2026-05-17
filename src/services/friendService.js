const {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");

const TableName = () => getTableName();

function friendSk(otherUserId) {
  return `FRIEND#${otherUserId}`;
}

function freqOutSk(otherUserId) {
  return `FREQ_OUT#${otherUserId}`;
}

function freqInSk(otherUserId) {
  return `FREQ_IN#${otherUserId}`;
}

async function getFriendLink({ userId, otherUserId }) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: `USER#${userId}`, SK: friendSk(otherUserId) },
    }),
  );
  return res.Item || null;
}

async function assertFriends({ userIdA, userIdB }) {
  const link = await getFriendLink({ userId: userIdA, otherUserId: userIdB });
  if (!link) {
    const err = new Error("NOT_FRIENDS");
    err.code = "NOT_FRIENDS";
    throw err;
  }
  return link;
}

async function getFriendRequest({ userId, otherUserId, direction }) {
  const sk = direction === "IN" ? freqInSk(otherUserId) : freqOutSk(otherUserId);
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: `USER#${userId}`, SK: sk },
    }),
  );
  return res.Item || null;
}

async function listFriends(userId) {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":p": "FRIEND#",
      },
    }),
  );
  return (res.Items || []).map((it) => ({
    otherUserId: it.otherUserId,
    createdAt: it.createdAt,
  }));
}

async function listFriendRequests(userId, type) {
  const prefix = type === "outgoing" ? "FREQ_OUT#" : "FREQ_IN#";
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":p": prefix,
      },
    }),
  );
  return (res.Items || []).map((it) => ({
    otherUserId: it.otherUserId,
    direction: it.direction,
    status: it.status,
    createdAt: it.createdAt,
  }));
}

async function sendFriendRequest({ userId, otherUserId }) {
  const from = String(userId || "");
  const to = String(otherUserId || "");

  if (!from || !to) {
    const err = new Error("INVALID_USER");
    err.code = "INVALID_USER";
    throw err;
  }
  if (from === to) {
    const err = new Error("CANNOT_FRIEND_SELF");
    err.code = "CANNOT_FRIEND_SELF";
    throw err;
  }
}






