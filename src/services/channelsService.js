const { randomUUID } = require("crypto");
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  convPk,
  META_SK,
  channelSk,
} = require("../lib/keys");

const TableName = () => getTableName();

const CHANNEL_TYPES = new Set(["INFO", "CHAT", "VOICE"]);

function parseChannelItem(item) {
  if (!item || item.entityType !== "Channel") return null;
  const sk = String(item.SK || "");
  const parts = sk.split("#");
  if (parts.length < 3 || parts[0] !== "CHANNEL") return null;
  return {
    channelId: item.channelId || parts[2] || "",
    channelType: String(item.channelType || parts[1] || "").toUpperCase(),
    name: String(item.name || ""),
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    conversationId: item.conversationId,
  };
}

function toChannelDto(item) {
  const p = parseChannelItem(item);
  if (!p || !p.channelId) return null;
  return {
    channelId: p.channelId,
    channelType: p.channelType,
    name: p.name,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
  };
}

async function getConversationMetaLocal(conversationId) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: META_SK },
    }),
  );
  return res.Item || null;
}

async function queryChannelItems(conversationId) {
  const out = [];
  let ExclusiveStartKey = undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pre)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":pre": "CHANNEL#",
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

async function countChannelsByType(items, channelType) {
  const t = String(channelType || "").toUpperCase();
  return items.filter((it) => parseChannelItem(it)?.channelType === t).length;
}

/**
 * After group meta + members exist: create default INFO, CHAT, VOICE channels.
 */
async function seedDefaultChannelsForNewGroup({ conversationId, createdBy }) {
  const now = new Date().toISOString();
  const idInfo = randomUUID();
  const idChat = randomUUID();
  const idVoice = randomUUID();

  const base = (channelType, channelId, name) => ({
    PK: convPk(conversationId),
    SK: channelSk(channelType, channelId),
    entityType: "Channel",
    conversationId,
    channelId,
    channelType,
    name,
    createdAt: now,
    createdBy: String(createdBy || ""),
  });

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TableName(),
            Item: base("INFO", idInfo, "thông-tin"),
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: base("CHAT", idChat, "chung"),
          },
        },
        {
          Put: {
            TableName: TableName(),
            Item: base("VOICE", idVoice, "thoại-chung"),
          },
        },
      ],
    }),
  );

  return [idInfo, idChat, idVoice];
}

/**
 * Legacy GROUP without CHANNEL rows: create defaults (migration-on-read).
 */
async function ensureDefaultChannelsIfMissing({ conversationId, createdBy }) {
  const meta = await getConversationMetaLocal(conversationId);
  if (!meta || meta.type !== "GROUP") return [];
  const existing = await queryChannelItems(conversationId);
  if (existing.length > 0) return existing;
  await seedDefaultChannelsForNewGroup({
    conversationId,
    createdBy: createdBy || meta.createdBy || "",
  });
  return queryChannelItems(conversationId);
}

async function listChannels({ conversationId, userId }) {
  const meta = await getConversationMetaLocal(conversationId);
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

  let items = await queryChannelItems(conversationId);
  if (items.length === 0) {
    items = await ensureDefaultChannelsIfMissing({
      conversationId,
      createdBy: userId || meta.createdBy,
    });
  }

  const channels = items.map(toChannelDto).filter(Boolean);
  channels.sort((a, b) => {
    const ta = String(a.channelType).localeCompare(String(b.channelType));
    if (ta !== 0) return ta;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  return channels;
}

async function getChannelById(conversationId, channelId) {
  const items = await queryChannelItems(conversationId);
  const id = String(channelId || "");
  const found = items.find((it) => String(it.channelId || "") === id);
  return found ? parseChannelItem(found) : null;
}

async function getDefaultChatChannelIdForGroup(conversationId) {
  const channels = await listChannels({ conversationId });
  const chat = channels.filter((c) => c.channelType === "CHAT").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return chat[0]?.channelId || null;
}

async function assertOwnerOrAdmin(member) {
  const r = String(member?.role || "").toUpperCase();
  if (r !== "OWNER" && r !== "ADMIN") {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }
}

async function createChannel({ conversationId, actorMember, channelType, name }) {
  await assertOwnerOrAdmin(actorMember);
  const ct = String(channelType || "").trim().toUpperCase();
  if (!CHANNEL_TYPES.has(ct)) {
    const err = new Error("INVALID_CHANNEL_TYPE");
    err.code = "INVALID_CHANNEL_TYPE";
    throw err;
  }
  const meta = await getConversationMetaLocal(conversationId);
  if (!meta || meta.type !== "GROUP") {
    const err = new Error("NOT_A_GROUP");
    err.code = "NOT_A_GROUP";
    throw err;
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    const err = new Error("INVALID_NAME");
    err.code = "INVALID_NAME";
    throw err;
  }

  const channelId = randomUUID();
  const now = new Date().toISOString();
  const item = {
    PK: convPk(conversationId),
    SK: channelSk(ct, channelId),
    entityType: "Channel",
    conversationId,
    channelId,
    channelType: ct,
    name: trimmed,
    createdAt: now,
    createdBy: String(actorMember.userId || ""),
  };

  await docClient.send(
    new PutCommand({
      TableName: TableName(),
      Item: item,
      ConditionExpression: "attribute_not_exists(SK)",
    }),
  );

  return toChannelDto(item);
}

async function updateChannel({ conversationId, actorMember, channelId, name }) {
  await assertOwnerOrAdmin(actorMember);
  const ch = await getChannelById(conversationId, channelId);
  if (!ch) {
    const err = new Error("CHANNEL_NOT_FOUND");
    err.code = "CHANNEL_NOT_FOUND";
    throw err;
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    const err = new Error("INVALID_NAME");
    err.code = "INVALID_NAME";
    throw err;
  }

  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: channelSk(ch.channelType, channelId) },
      UpdateExpression: "SET #n = :n, updatedAt = :u",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": trimmed, ":u": now },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );

  const updated = await getChannelById(conversationId, channelId);
  return {
    channelId: updated.channelId,
    channelType: updated.channelType,
    name: trimmed,
    createdAt: updated.createdAt,
    createdBy: updated.createdBy,
    updatedAt: now,
  };
}

async function deleteChannel({ conversationId, actorMember, channelId }) {
  await assertOwnerOrAdmin(actorMember);
  const ch = await getChannelById(conversationId, channelId);
  if (!ch) {
    const err = new Error("CHANNEL_NOT_FOUND");
    err.code = "CHANNEL_NOT_FOUND";
    throw err;
  }

  const items = await queryChannelItems(conversationId);
  const sameTypeCount = await countChannelsByType(items, ch.channelType);
  if (sameTypeCount <= 1) {
    const err = new Error("LAST_CHANNEL_OF_TYPE");
    err.code = "LAST_CHANNEL_OF_TYPE";
    throw err;
  }

  const { deleteAllMessagesForChannel } = require("./messageService");
  const { deletedCount } = await deleteAllMessagesForChannel({
    conversationId,
    channelId,
  });

  await docClient.send(
    new DeleteCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: channelSk(ch.channelType, channelId) },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );

  return { channelId, deleted: true, messagesDeleted: deletedCount };
}

async function getDefaultVoiceChannelIdForGroup(conversationId) {
  const channels = await listChannels({ conversationId });
  const voice = channels
    .filter((c) => c.channelType === "VOICE")
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return voice[0]?.channelId || null;
}

module.exports = {
  CHANNEL_TYPES,
  listChannels,
  getChannelById,
  getDefaultChatChannelIdForGroup,
  getDefaultVoiceChannelIdForGroup,
  seedDefaultChannelsForNewGroup,
  ensureDefaultChannelsIfMissing,
  createChannel,
  updateChannel,
  deleteChannel,
};
