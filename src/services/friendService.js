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



