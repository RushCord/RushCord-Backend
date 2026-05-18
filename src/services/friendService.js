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

  const [existingFriend, outReq, inReq] = await Promise.all([
    getFriendLink({ userId: from, otherUserId: to }),
    getFriendRequest({ userId: from, otherUserId: to, direction: "OUT" }),
    getFriendRequest({ userId: from, otherUserId: to, direction: "IN" }),
  ]);

  if (existingFriend) {
    const err = new Error("ALREADY_FRIENDS");
    err.code = "ALREADY_FRIENDS";
    throw err;
  }
  if (outReq || inReq) {
    const err = new Error("FRIEND_REQUEST_EXISTS");
    err.code = "FRIEND_REQUEST_EXISTS";
    throw err;
  }

  // If the other user already sent you a request, accept should be used instead.
  const otherOutToMe = await getFriendRequest({
    userId: to,
    otherUserId: from,
    direction: "OUT",
  });
  if (otherOutToMe) {
    const err = new Error("FRIEND_REQUEST_EXISTS");
    err.code = "FRIEND_REQUEST_EXISTS";
    throw err;
  }

  const createdAt = new Date().toISOString();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: `USER#${from}`,
              SK: freqOutSk(to),
              entityType: "FriendRequest",
              userId: from,
              otherUserId: to,
              direction: "OUT",
              status: "PENDING",
              createdAt,
            },
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: `USER#${to}`,
              SK: freqInSk(from),
              entityType: "FriendRequest",
              userId: to,
              otherUserId: from,
              direction: "IN",
              status: "PENDING",
              createdAt,
            },
          },
        },
      ],
    }),
  );

  return { otherUserId: to, status: "PENDING", createdAt };
}

async function acceptFriendRequest({ userId, otherUserId }) {
  const me = String(userId || "");
  const other = String(otherUserId || "");

  if (!me || !other) {
    const err = new Error("INVALID_USER");
    err.code = "INVALID_USER";
    throw err;
  }
  if (me === other) {
    const err = new Error("CANNOT_FRIEND_SELF");
    err.code = "CANNOT_FRIEND_SELF";
    throw err;
  }

  const [incoming, outgoing] = await Promise.all([
    getFriendRequest({ userId: me, otherUserId: other, direction: "IN" }),
    getFriendRequest({ userId: other, otherUserId: me, direction: "OUT" }),
  ]);

  if (!incoming || !outgoing) {
    const err = new Error("FRIEND_REQUEST_NOT_FOUND");
    err.code = "FRIEND_REQUEST_NOT_FOUND";
    throw err;
  }

  const createdAt = new Date().toISOString();
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: `USER#${me}`, SK: freqInSk(other) },
          },
        },
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: `USER#${other}`, SK: freqOutSk(me) },
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: `USER#${me}`,
              SK: friendSk(other),
              entityType: "Friend",
              userId: me,
              otherUserId: other,
              status: "ACCEPTED",
              createdAt,
            },
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: `USER#${other}`,
              SK: friendSk(me),
              entityType: "Friend",
              userId: other,
              otherUserId: me,
              status: "ACCEPTED",
              createdAt,
            },
          },
        },
      ],
    }),
  );

  return { otherUserId: other, status: "ACCEPTED", createdAt };
}

async function deleteFriendRequest({ userId, otherUserId }) {
  const me = String(userId || "");
  const other = String(otherUserId || "");

  if (!me || !other) {
    const err = new Error("INVALID_USER");
    err.code = "INVALID_USER";
    throw err;
  }
  if (me === other) {
    const err = new Error("CANNOT_FRIEND_SELF");
    err.code = "CANNOT_FRIEND_SELF";
    throw err;
  }

  const [incoming, outgoing] = await Promise.all([
    getFriendRequest({ userId: me, otherUserId: other, direction: "IN" }),
    getFriendRequest({ userId: me, otherUserId: other, direction: "OUT" }),
  ]);

  if (!incoming && !outgoing) {
    const err = new Error("FRIEND_REQUEST_NOT_FOUND");
    err.code = "FRIEND_REQUEST_NOT_FOUND";
    throw err;
  }

  // Determine counterpart keys to delete both sides.
  const transact = [];
  if (incoming) {
    transact.push({
      Delete: {
        TableName: TableName(),
        Key: { PK: `USER#${me}`, SK: freqInSk(other) },
      },
    });
    transact.push({
      Delete: {
        TableName: TableName(),
        Key: { PK: `USER#${other}`, SK: freqOutSk(me) },
      },
    });
  } else if (outgoing) {
    transact.push({
      Delete: {
        TableName: TableName(),
        Key: { PK: `USER#${me}`, SK: freqOutSk(other) },
      },
    });
    transact.push({
      Delete: {
        TableName: TableName(),
        Key: { PK: `USER#${other}`, SK: freqInSk(me) },
      },
    });
  }

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: transact,
    }),
  );

  return { otherUserId: other, deleted: true };
}

async function unfriend({ userId, otherUserId }) {
  const me = String(userId || "");
  const other = String(otherUserId || "");
  if (!me || !other) {
    const err = new Error("INVALID_USER");
    err.code = "INVALID_USER";
    throw err;
  }
  if (me === other) {
    const err = new Error("CANNOT_UNFRIEND_SELF");
    err.code = "CANNOT_UNFRIEND_SELF";
    throw err;
  }

  const [a, b] = await Promise.all([
    getFriendLink({ userId: me, otherUserId: other }),
    getFriendLink({ userId: other, otherUserId: me }),
  ]);
  if (!a && !b) return { otherUserId: other, deleted: true };

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: `USER#${me}`, SK: friendSk(other) },
          },
        },
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: `USER#${other}`, SK: friendSk(me) },
          },
        },
      ],
    }),
  );

  return { otherUserId: other, deleted: true };
}













