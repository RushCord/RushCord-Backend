const { randomUUID } = require("crypto");
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const { convPk, META_SK, memberSk, userPk, userConvSk, gsi2Pk, gsi2InboxSk } = require("../lib/keys");
const { getProfileRaw } = require("./userService");

const TableName = () => getTableName();

function toConversationDto({ meta, inbox, lastMessage }) {
  if (!meta && !inbox) return null;
  const type = meta?.type || inbox?.type || "DM";
  return {
    conversationId: meta?.conversationId || inbox?.conversationId,
    type,
    title: type === "GROUP" ? meta?.title || "" : meta?.title, // DM title optional
    avatar: meta?.avatar || "",
    createdAt: meta?.createdAt,
    createdBy: meta?.createdBy,
    memberCount: meta?.memberCount,
    otherUserId: inbox?.otherUserId,
    lastMessageAt: meta?.lastMessageAt || inbox?.lastMessageAt,
    lastMessageId: meta?.lastMessageId || inbox?.lastMessageId,
    lastMessageSK: meta?.lastMessageSK || inbox?.lastMessageSK,
    lastReadSK: inbox?.lastReadSK || "",
    lastMessage: lastMessage || null,
  };
}

async function getConversationMeta(conversationId) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: META_SK },
    }),
  );
  return res.Item || null;
}

async function listConversationMembers(conversationId) {
  const out = [];
  let ExclusiveStartKey = undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :msk)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":msk": "MEMBER#",
        },
        ExclusiveStartKey,
      }),
    );
    if (Array.isArray(res.Items) && res.Items.length > 0) {
      out.push(...res.Items);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function getMessageBySk({ conversationId, messageSk }) {
  if (!messageSk) return null;
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: messageSk },
    }),
  );
  return res.Item || null;
}

async function createGroupConversation({ creatorId, title, memberIds }) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) {
    const err = new Error("INVALID_TITLE");
    err.code = "INVALID_TITLE";
    throw err;
  }
  const inputMembers = Array.isArray(memberIds) ? memberIds : [];
  const allMembers = Array.from(new Set([String(creatorId), ...inputMembers.map(String)])).filter(Boolean);
  if (allMembers.length < 2) {
    const err = new Error("INVALID_MEMBERS");
    err.code = "INVALID_MEMBERS";
    throw err;
  }

  // Validate all member profiles exist (cheap: GetItem per user).
  const profiles = await Promise.all(allMembers.map((uid) => getProfileRaw(uid)));
  const missing = [];
  for (let i = 0; i < allMembers.length; i++) {
    if (!profiles[i]) missing.push(allMembers[i]);
  }
  if (missing.length > 0) {
    const err = new Error("USER_NOT_FOUND");
    err.code = "USER_NOT_FOUND";
    err.missingUserIds = missing;
    throw err;
  }

  const conversationId = `GROUP#${randomUUID()}`;
  const now = new Date().toISOString();

  const metaItem = {
    PK: convPk(conversationId),
    SK: META_SK,
    entityType: "ConversationMeta",
    conversationId,
    type: "GROUP",
    title: trimmedTitle,
    avatar: "",
    createdAt: now,
    createdBy: String(creatorId),
    lastMessageAt: now,
    lastMessageId: "",
    lastMessageSK: "",
    memberCount: allMembers.length,
  };

  const transactItems = [];

  transactItems.push({
    Put: {
      TableName: TableName(),
      Item: metaItem,
      ConditionExpression: "attribute_not_exists(PK)",
    },
  });

  for (let i = 0; i < allMembers.length; i++) {
    const userId = allMembers[i];
    const profile = profiles[i];
    transactItems.push({
      Put: {
        TableName: TableName(),
        Item: {
          PK: convPk(conversationId),
          SK: memberSk(userId),
          entityType: "ConversationMember",
          conversationId,
          userId,
          fullName: profile.fullName,
          role: userId === String(creatorId) ? "OWNER" : "MEMBER",
          joinedAt: now,
          status: "ACCEPTED",
        },
      },
    });

    // Create inbox row for each member so it appears in their conversation list.
    transactItems.push({
      Put: {
        TableName: TableName(),
        Item: {
          PK: userPk(userId),
          SK: userConvSk(conversationId),
          entityType: "UserConversation",
          userId,
          conversationId,
          type: "GROUP",
          otherUserId: undefined,
          lastMessageAt: now,
          lastMessageId: "",
          lastMessageSK: "",
          lastReadSK: "",
          GSI2PK: gsi2Pk(userId),
          GSI2SK: gsi2InboxSk(now, conversationId),
        },
      },
    });
  }

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: transactItems,
    }),
  );

  return metaItem;
}

async function listUserConversations({ userId, limit = 30 }) {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: {
        ":pk": gsi2Pk(userId),
      },
      ScanIndexForward: false,
      Limit: Math.max(1, Math.min(100, Number(limit) || 30)),
    }),
  );
  const inboxItems = res.Items || [];

  // Hydrate meta + lastMessage (best effort).
  const metas = await Promise.all(
    inboxItems.map((it) => getConversationMeta(it.conversationId)),
  );
  const lastMsgs = await Promise.all(
    inboxItems.map((it, idx) =>
      getMessageBySk({ conversationId: it.conversationId, messageSk: metas[idx]?.lastMessageSK || it.lastMessageSK }),
    ),
  );

  return inboxItems
    .map((inbox, idx) =>
      toConversationDto({
        meta: metas[idx],
        inbox,
        lastMessage: lastMsgs[idx] || null,
      }),
    )
    .filter(Boolean);
}

async function updateGroupConversationMeta({
  conversationId,
  title,
  avatar,
}) {
  const meta = await getConversationMeta(conversationId);
  if (!meta) {
    const err = new Error("CONVERSATION_NOT_FOUND");
    err.code = "CONVERSATION_NOT_FOUND";
    throw err;
  }
  if (meta.type !== "GROUP") {
    const err = new Error("NOT_A_GROUP");
    err.code = "NOT_A_GROUP";
    throw err;
  }

  const nextTitle =
    title === undefined ? undefined : String(title || "").trim();
  if (nextTitle !== undefined && !nextTitle) {
    const err = new Error("INVALID_TITLE");
    err.code = "INVALID_TITLE";
    throw err;
  }

  const nextAvatar =
    avatar === undefined ? undefined : String(avatar || "").trim();

  if (nextTitle === undefined && nextAvatar === undefined) {
    return meta;
  }

  const sets = [];
  const names = {};
  const values = {};
  if (nextTitle !== undefined) {
    sets.push("#t = :t");
    names["#t"] = "title";
    values[":t"] = nextTitle;
  }
  if (nextAvatar !== undefined) {
    sets.push("#a = :a");
    names["#a"] = "avatar";
    values[":a"] = nextAvatar;
  }
  sets.push("updatedAt = :u");
  values[":u"] = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: META_SK },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );

  return (await getConversationMeta(conversationId)) || meta;
}

async function updateConversationMemberRole({ conversationId, userId, nextRole }) {
  const role = String(nextRole || "").trim().toUpperCase();
  if (role !== "MEMBER" && role !== "ADMIN") {
    const err = new Error("INVALID_ROLE");
    err.code = "INVALID_ROLE";
    throw err;
  }
  const updatedAt = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: memberSk(userId) },
      UpdateExpression: "SET #r = :r, updatedAt = :u",
      ExpressionAttributeNames: { "#r": "role" },
      ExpressionAttributeValues: { ":r": role, ":u": updatedAt },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
  return { userId, role, updatedAt };
}

async function removeConversationMember({ conversationId, userId }) {
  const now = new Date().toISOString();
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: convPk(conversationId), SK: memberSk(userId) },
          },
        },
        {
          Delete: {
            TableName: TableName(),
            Key: { PK: userPk(userId), SK: userConvSk(conversationId) },
          },
        },
        {
          Update: {
            TableName: TableName(),
            Key: { PK: convPk(conversationId), SK: META_SK },
            UpdateExpression:
              "SET updatedAt = :u ADD memberCount :negOne",
            ExpressionAttributeValues: {
              ":u": now,
              ":negOne": -1,
            },
          },
        },
      ],
    }),
  );
  return { userId, removed: true, updatedAt: now };
}

async function addConversationMember({ conversationId, userId }) {
  const meta = await getConversationMeta(conversationId);
  if (!meta) {
    const err = new Error("CONVERSATION_NOT_FOUND");
    err.code = "CONVERSATION_NOT_FOUND";
    throw err;
  }
  if (meta.type !== "GROUP") {
    const err = new Error("NOT_A_GROUP");
    err.code = "NOT_A_GROUP";
    throw err;
  }

  const profile = await getProfileRaw(userId);
  if (!profile) {
    const err = new Error("USER_NOT_FOUND");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const now = new Date().toISOString();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: convPk(conversationId),
              SK: memberSk(userId),
              entityType: "ConversationMember",
              conversationId,
              userId: String(userId),
              fullName: profile.fullName,
              role: "MEMBER",
              joinedAt: now,
              status: "ACCEPTED",
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: {
              PK: userPk(userId),
              SK: userConvSk(conversationId),
              entityType: "UserConversation",
              userId: String(userId),
              conversationId,
              type: "GROUP",
              otherUserId: undefined,
              lastMessageAt: meta.lastMessageAt || now,
              lastMessageId: meta.lastMessageId || "",
              lastMessageSK: meta.lastMessageSK || "",
              lastReadSK: "",
              GSI2PK: gsi2Pk(userId),
              GSI2SK: gsi2InboxSk(meta.lastMessageAt || now, conversationId),
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Update: {
            TableName: TableName(),
            Key: { PK: convPk(conversationId), SK: META_SK },
            UpdateExpression: "SET updatedAt = :u ADD memberCount :one",
            ExpressionAttributeValues: {
              ":u": now,
              ":one": 1,
            },
          },
        },
      ],
    }),
  );

  return {
    userId: String(userId),
    fullName: profile.fullName,
    role: "MEMBER",
    joinedAt: now,
  };
}

async function deleteConversationInboxRows({ conversationId, userIds }) {
  const ids = Array.isArray(userIds) ? userIds.map(String).filter(Boolean) : [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: batch.map((uid) => ({
          Delete: {
            TableName: TableName(),
            Key: { PK: userPk(uid), SK: userConvSk(conversationId) },
          },
        })),
      }),
    );
  }
}

async function deleteConversationPartition({ conversationId }) {
  const pk = convPk(conversationId);
  let ExclusiveStartKey = undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey,
      }),
    );
    const keys = (res.Items || []).map((it) => ({ PK: it.PK, SK: it.SK })).filter((k) => k.PK && k.SK);
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: chunk.map((key) => ({
            Delete: { TableName: TableName(), Key: key },
          })),
        }),
      );
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

async function dissolveGroupConversation({ conversationId }) {
  const meta = await getConversationMeta(conversationId);
  if (!meta) {
    const err = new Error("CONVERSATION_NOT_FOUND");
    err.code = "CONVERSATION_NOT_FOUND";
    throw err;
  }
  if (meta.type !== "GROUP") {
    const err = new Error("NOT_A_GROUP");
    err.code = "NOT_A_GROUP";
    throw err;
  }

  const members = await listConversationMembers(conversationId);
  const userIds = members.map((m) => String(m.userId || "")).filter(Boolean);

  // Delete inbox rows first so it disappears from users' list even if partition delete takes time.
  await deleteConversationInboxRows({ conversationId, userIds });

  // Delete everything under conversation PK: meta, members, messages, etc.
  await deleteConversationPartition({ conversationId });

  return { conversationId, deleted: true };
}

module.exports = {
  createGroupConversation,
  listUserConversations,
  listConversationMembers,
  getConversationMeta,
  updateGroupConversationMeta,
  updateConversationMemberRole,
  removeConversationMember,
  addConversationMember,
  dissolveGroupConversation,
};

