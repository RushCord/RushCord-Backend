const { randomUUID } = require("crypto");
const {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  userPk,
  convPk,
  META_SK,
  memberSk,
  userConvSk,
  dmConversationId,
  messageSk,
  channelMessageSk,
  channelMessageSkPrefix,
  gsi1MessagePk,
  gsi1MessageSk,
  gsi1MessageSkForRow,
  gsi2Pk,
  gsi2InboxSk,
} = require("../lib/keys");
const {
  getChannelById,
  getDefaultChatChannelIdForGroup,
  listChannels,
} = require("./channelsService");
const { getProfileRaw } = require("./userService");
const { assertFriends } = require("./friendService");
const { deleteObjectByKey } = require("../lib/s3Media");

const TableName = () => getTableName();

function hasHiddenFor(item, viewerId) {
  if (!viewerId || !item || !item.hiddenFor) return false;
  const hf = item.hiddenFor;
  if (hf instanceof Set) return hf.has(viewerId);
  if (Array.isArray(hf)) return hf.includes(viewerId);
  return false;
}

function messageToLegacy(item, viewerId) {
  if (!item) return null;
  const recalled = item.recallScope === "ALL";
  const deletedForMe = hasHiddenFor(item, viewerId);
  const isEdited = Array.isArray(item.editHistory) && item.editHistory.length > 0;
  const reactionCounts = (() => {
    const r = item.reactionsByEmoji;
    if (!r || typeof r !== "object") return {};
    const out = {};
    for (const [emoji, users] of Object.entries(r)) {
      if (!emoji) continue;
      if (users instanceof Set) out[emoji] = users.size;
      else if (Array.isArray(users)) out[emoji] = users.length;
      else out[emoji] = 0;
    }
    return out;
  })();
  const dto = {
    _id: item.messageId,
    conversationId: item.conversationId,
    channelId: item.channelId ? String(item.channelId) : undefined,
    senderId: item.senderId,
    receiverId: item.receiverId,
    isSystem: !!item.isSystem,
    isForwarded: !!item.isForwarded,
    isRecalled: recalled,
    isDeletedForMe: deletedForMe,
    isEdited,
    editedAt: typeof item.editedAt === "string" ? item.editedAt : undefined,
    createdAt: item.createdAt,
    reactionCounts,
  };
  if (!recalled && !deletedForMe) {
    if (item.text) dto.text = item.text;
    if (isEdited) {
      dto.editHistory = Array.isArray(item.editHistory) ? item.editHistory : [];
    }
    if (Array.isArray(item.mediaItems) && item.mediaItems.length > 0) {
      const urls = item.mediaItems
        .map((m) => m?.publicUrl)
        .filter((u) => typeof u === "string" && u.length > 0);

      if (item.type === "IMAGES" || urls.length > 1) {
        dto.images = urls;
      } else {
        const first = item.mediaItems[0];
        const ct = String(first?.contentType || "").toLowerCase();
        if (ct.startsWith("image/")) {
          dto.image = urls[0];
        } else {
          dto.file = urls[0];
          if (typeof first?.fileName === "string" && first.fileName.length > 0) {
            dto.fileName = first.fileName;
          }
          dto.contentType = ct;
        }
      }
    }
  }
  return dto;
}

async function listConversationMessages(viewerId, conversationId, channelId, options = {}) {
  const limit =
    options?.limit != null ? Math.min(100, Math.max(1, Number(options.limit) || 50)) : undefined;

  if (String(conversationId || "").startsWith("DM#")) {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": "MSG#",
        },
        ScanIndexForward: false,
        ...(limit ? { Limit: limit } : {}),
      }),
    );
    const items = (res.Items || [])
      .map((it) => messageToLegacy(it, viewerId))
      .filter(Boolean);
    items.reverse();
    return items;
  }

  let rows;
  if (channelId) {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": channelMessageSkPrefix(channelId),
        },
        ScanIndexForward: false,
        ...(limit ? { Limit: limit } : {}),
      }),
    );
    rows = res.Items || [];
  } else {
    const defaultChat = await getDefaultChatChannelIdForGroup(conversationId);
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": "MSG#",
        },
        ScanIndexForward: false,
        ...(limit ? { Limit: limit } : {}),
      }),
    );
    rows = (res.Items || []).filter((it) => {
      const sk = String(it.SK || "");
      if (sk.startsWith("MSG#CH#")) {
        return defaultChat && sk.startsWith(channelMessageSkPrefix(defaultChat));
      }
      return true;
    });
  }

  const items = rows
    .map((it) => messageToLegacy(it, viewerId))
    .filter(Boolean);
  items.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return items;
}

async function listConversationMemberUserIds(conversationId) {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :msk)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":msk": "MEMBER#",
      },
      ProjectionExpression: "userId",
    }),
  );
  return (res.Items || [])
    .map((it) => String(it.userId || ""))
    .filter(Boolean);
}

async function sendConversationMessage({
  conversationId,
  senderId,
  text,
  imageUrl,
  fileUrl,
  images,
  s3Key,
  mimeType,
  fileName,
  sizeBytes,
  isForwarded,
  conversationType = "GROUP",
  isSystem = false,
  channelId: channelIdArg,
}) {
  const isGroupConv = String(conversationId || "").startsWith("GROUP#");

  let channelId = channelIdArg;
  if (isGroupConv) {
    if (!channelId && isSystem) {
      channelId = await getDefaultChatChannelIdForGroup(conversationId);
    }
    if (!channelId) {
      const err = new Error("CHANNEL_REQUIRED");
      err.code = "CHANNEL_REQUIRED";
      throw err;
    }
    const ch = await getChannelById(conversationId, channelId);
    if (!ch) {
      const err = new Error("CHANNEL_NOT_FOUND");
      err.code = "CHANNEL_NOT_FOUND";
      throw err;
    }
    if (ch.channelType === "VOICE") {
      const err = new Error("CANNOT_MESSAGE_VOICE");
      err.code = "CANNOT_MESSAGE_VOICE";
      throw err;
    }
  }

  const messageId = randomUUID();
  const createdAt = new Date().toISOString();
  const sk =
    isGroupConv && channelId
      ? channelMessageSk(channelId, createdAt, messageId)
      : messageSk(createdAt, messageId);

  let type;
  let mediaItems;
  if (Array.isArray(images) && images.length > 0) {
    type = "IMAGES";
    mediaItems = images.map((img) => ({
      s3Key: String(img.s3Key || ""),
      publicUrl: String(img.fileUrl || ""),
      fileName: String(img.fileName || "image"),
      contentType: String(img.mimeType || "image/jpeg"),
      sizeBytes: Number(img.sizeBytes ?? 0) || 0,
    }));
  } else {
    const inferred = inferMessageTypeAndMediaItems({
      text,
      imageUrl,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
    });
    type = inferred.type;
    mediaItems = inferred.mediaItems;
  }

  const gsi1SK = isGroupConv
    ? gsi1MessageSkForRow(conversationId, sk)
    : gsi1MessageSk(conversationId, createdAt, messageId);

  const msgItem = {
    PK: convPk(conversationId),
    SK: sk,
    GSI1PK: gsi1MessagePk(messageId),
    GSI1SK: gsi1SK,
    entityType: "Message",
    conversationId,
    messageId,
    createdAt,
    senderId,
    receiverId: undefined,
    isSystem: !!isSystem,
    type,
    text: type === "TEXT" ? text || "" : text || undefined,
    isForwarded: !!isForwarded,
    recallScope: null,
    editHistory: [],
    reactionsByEmoji: {},
    ...(isGroupConv && channelId ? { channelId: String(channelId) } : {}),
    ...(mediaItems ? { mediaItems } : {}),
  };

  // Update conversation meta + write message atomically.
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TableName(),
            Key: { PK: convPk(conversationId), SK: META_SK },
            UpdateExpression: [
              "SET lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
              ", conversationId = if_not_exists(conversationId, :cid)",
              ", #tp = if_not_exists(#tp, :tp)",
              ", createdAt = if_not_exists(createdAt, :ts)",
              ", createdBy = if_not_exists(createdBy, :creator)",
            ].join(" "),
            ExpressionAttributeNames: { "#tp": "type" },
            ExpressionAttributeValues: {
              ":ts": createdAt,
              ":mid": messageId,
              ":msk": sk,
              ":cid": conversationId,
              ":tp": conversationType,
              ":creator": senderId,
            },
          },
        },
        { Put: { TableName: TableName(), Item: msgItem } },
      ],
    }),
  );

  // Best-effort inbox updates for all members so the conversation bubbles to top.
  let memberIds = [];
  try {
    memberIds = await listConversationMemberUserIds(conversationId);
  } catch {
    memberIds = [String(senderId)];
  }
  const g2sk = gsi2InboxSk(createdAt, conversationId);

  await Promise.all(
    memberIds.map((uid) =>
      docClient.send(
        new UpdateCommand({
          TableName: TableName(),
          Key: { PK: userPk(uid), SK: userConvSk(conversationId) },
          UpdateExpression: [
            "SET userId = :uid, conversationId = :cid, #tp = :tp",
            ", lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
            ", GSI2PK = :g2pk, GSI2SK = :g2sk",
            ", lastReadSK = if_not_exists(lastReadSK, :empty)",
          ].join(" "),
          ExpressionAttributeNames: { "#tp": "type" },
          ExpressionAttributeValues: {
            ":uid": uid,
            ":cid": conversationId,
            ":tp": conversationType,
            ":ts": createdAt,
            ":mid": messageId,
            ":msk": sk,
            ":g2pk": gsi2Pk(uid),
            ":g2sk": g2sk,
            ":empty": "",
          },
        }),
      ),
    ),
  );

  return messageToLegacy(msgItem, senderId);
}

function inferMessageTypeAndMediaItems({
  text,
  imageUrl,
  fileUrl,
  s3Key,
  mimeType,
  fileName,
  sizeBytes,
}) {
  if (imageUrl) {
    return {
      type: "IMAGE",
      mediaItems: [
        {
          s3Key: s3Key || "",
          publicUrl: imageUrl,
          fileName: fileName || "image",
          contentType: mimeType || "image/jpeg",
          sizeBytes: sizeBytes ?? 0,
        },
      ],
    };
  }
  if (fileUrl) {
    const isImage =
      typeof mimeType === "string" && mimeType.startsWith("image/");
    if (isImage) {
      return {
        type: "IMAGE",
        mediaItems: [
          {
            s3Key: s3Key || "",
            publicUrl: fileUrl,
            fileName: fileName || "image",
            contentType: mimeType || "image/jpeg",
            sizeBytes: sizeBytes ?? 0,
          },
        ],
      };
    }
    return {
      type: "FILE",
      mediaItems: [
        {
          s3Key: s3Key || "",
          publicUrl: fileUrl,
          fileName: fileName || "file",
          contentType: mimeType || "application/octet-stream",
          sizeBytes: sizeBytes ?? 0,
        },
      ],
    };
  }
  return { type: "TEXT", mediaItems: undefined };
}

async function listDirectMessages(viewerId, otherUserId) {
  await assertFriends({ userIdA: viewerId, userIdB: otherUserId });
  const conversationId = dmConversationId(viewerId, otherUserId);
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":ms": "MSG#",
      },
      ScanIndexForward: false,
    }),
  );
  const items = (res.Items || [])
    .map((it) => messageToLegacy(it, viewerId))
    .filter(Boolean);
  items.reverse();
  return items;
}

async function sendDirectMessage({
  senderId,
  receiverId,
  text,
  imageUrl,
  fileUrl,
  images,
  s3Key,
  mimeType,
  fileName,
  sizeBytes,
  isForwarded,
}) {
  await assertFriends({ userIdA: senderId, userIdB: receiverId });
  const [sender, receiver] = await Promise.all([
    getProfileRaw(senderId),
    getProfileRaw(receiverId),
  ]);
  if (!sender || !receiver) {
    const err = new Error("USER_NOT_FOUND");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const conversationId = dmConversationId(senderId, receiverId);
  const messageId = randomUUID();
  const createdAt = new Date().toISOString();
  const sk = messageSk(createdAt, messageId);

  let type;
  let mediaItems;
  if (Array.isArray(images) && images.length > 0) {
    type = "IMAGES";
    mediaItems = images.map((img) => ({
      s3Key: String(img.s3Key || ""),
      publicUrl: String(img.fileUrl || ""),
      fileName: String(img.fileName || "image"),
      contentType: String(img.mimeType || "image/jpeg"),
      sizeBytes: Number(img.sizeBytes ?? 0) || 0,
    }));
  } else {
    const inferred = inferMessageTypeAndMediaItems({
      text,
      imageUrl,
      fileUrl,
      s3Key,
      mimeType,
      fileName,
      sizeBytes,
    });
    type = inferred.type;
    mediaItems = inferred.mediaItems;
  }

  const msgItem = {
    PK: convPk(conversationId),
    SK: sk,
    GSI1PK: gsi1MessagePk(messageId),
    GSI1SK: gsi1MessageSk(conversationId, createdAt, messageId),
    entityType: "Message",
    conversationId,
    messageId,
    createdAt,
    senderId,
    receiverId,
    type,
    text: type === "TEXT" ? text || "" : text || undefined,
    isForwarded: !!isForwarded,
    recallScope: null,
    editHistory: [],
    reactionsByEmoji: {},
    ...(mediaItems ? { mediaItems } : {}),
  };

  const g2pkSender = gsi2Pk(senderId);
  const g2pkReceiver = gsi2Pk(receiverId);
  const g2sk = gsi2InboxSk(createdAt, conversationId);

  const transactItems = [
    {
      Update: {
        TableName: TableName(),
        Key: { PK: convPk(conversationId), SK: META_SK },
        UpdateExpression: [
          "SET lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
          ", conversationId = if_not_exists(conversationId, :cid)",
          ", #tp = if_not_exists(#tp, :dm)",
          ", createdAt = if_not_exists(createdAt, :ts)",
          ", createdBy = if_not_exists(createdBy, :creator)",
          ", memberCount = if_not_exists(memberCount, :two)",
        ].join(" "),
        ExpressionAttributeNames: { "#tp": "type" },
        ExpressionAttributeValues: {
          ":ts": createdAt,
          ":mid": messageId,
          ":msk": sk,
          ":cid": conversationId,
          ":dm": "DM",
          ":creator": senderId,
          ":two": 2,
        },
      },
    },
    {
      Put: {
        TableName: TableName(),
        Item: {
          PK: convPk(conversationId),
          SK: memberSk(senderId),
          entityType: "ConversationMember",
          conversationId,
          userId: senderId,
          fullName: sender.fullName,
          role: "MEMBER",
          joinedAt: createdAt,
          status: "ACCEPTED",
        },
      },
    },
    {
      Put: {
        TableName: TableName(),
        Item: {
          PK: convPk(conversationId),
          SK: memberSk(receiverId),
          entityType: "ConversationMember",
          conversationId,
          userId: receiverId,
          fullName: receiver.fullName,
          role: "MEMBER",
          joinedAt: createdAt,
          status: "ACCEPTED",
        },
      },
    },
    {
      Update: {
        TableName: TableName(),
        Key: { PK: userPk(senderId), SK: userConvSk(conversationId) },
        UpdateExpression: [
          "SET userId = :uid, conversationId = :cid, #tp = :dm, otherUserId = :other",
          ", lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
          ", GSI2PK = :g2pk, GSI2SK = :g2sk",
          ", lastReadSK = if_not_exists(lastReadSK, :empty)",
        ].join(" "),
        ExpressionAttributeNames: { "#tp": "type" },
        ExpressionAttributeValues: {
          ":uid": senderId,
          ":cid": conversationId,
          ":dm": "DM",
          ":other": receiverId,
          ":ts": createdAt,
          ":mid": messageId,
          ":msk": sk,
          ":g2pk": g2pkSender,
          ":g2sk": g2sk,
          ":empty": "",
        },
      },
    },
    {
      Update: {
        TableName: TableName(),
        Key: { PK: userPk(receiverId), SK: userConvSk(conversationId) },
        UpdateExpression: [
          "SET userId = :uid, conversationId = :cid, #tp = :dm, otherUserId = :other",
          ", lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
          ", GSI2PK = :g2pk, GSI2SK = :g2sk",
          ", lastReadSK = if_not_exists(lastReadSK, :empty)",
        ].join(" "),
        ExpressionAttributeNames: { "#tp": "type" },
        ExpressionAttributeValues: {
          ":uid": receiverId,
          ":cid": conversationId,
          ":dm": "DM",
          ":other": senderId,
          ":ts": createdAt,
          ":mid": messageId,
          ":msk": sk,
          ":g2pk": g2pkReceiver,
          ":g2sk": g2sk,
          ":empty": "",
        },
      },
    },
    {
      Put: {
        TableName: TableName(),
        Item: msgItem,
      },
    },
  ];

  await docClient.send(
    new TransactWriteCommand({ TransactItems: transactItems }),
  );

  return messageToLegacy(msgItem, senderId);
}

async function getMessageById(messageId) {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :g1",
      ExpressionAttributeValues: { ":g1": gsi1MessagePk(messageId) },
      Limit: 1,
    }),
  );
  return res.Items?.[0] || null;
}

function collectS3KeysFromMessageItem(item) {
  const keys = [];
  if (!item || !Array.isArray(item.mediaItems)) return keys;
  for (const it of item.mediaItems) {
    const k = it?.s3Key;
    if (typeof k === "string" && k.length > 0) keys.push(k);
  }
  return keys;
}

async function queryAllChannelMessageItems(conversationId, channelId) {
  const out = [];
  let ExclusiveStartKey = undefined;
  const prefix = channelMessageSkPrefix(channelId);
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :pre)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":pre": prefix,
        },
        ExclusiveStartKey,
      }),
    );
    if (Array.isArray(res.Items) && res.Items.length > 0) {
      out.push(...res.Items.filter((it) => it.entityType === "Message"));
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function batchDeleteMessageRows(items) {
  const table = TableName();
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: chunk.map((it) => ({
            DeleteRequest: {
              Key: { PK: it.PK, SK: it.SK },
            },
          })),
        },
      }),
    );
  }
}

async function findLatestConversationMessageItem(conversationId) {
  const rows = [];
  let ExclusiveStartKey = undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": "MSG#",
        },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items || []) {
      if (it.entityType === "Message") rows.push(it);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  if (rows.length === 0) return null;
  rows.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );
  return rows[0];
}

async function refreshConversationLastMessageAfterDeletes(conversationId) {
  const metaRes = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: META_SK },
    }),
  );
  const meta = metaRes.Item;
  if (!meta) return;

  const latest = await findLatestConversationMessageItem(conversationId);
  const conversationType = String(meta.type || "GROUP");
  const fallbackAt = String(meta.createdAt || new Date().toISOString());

  let memberIds = [];
  try {
    memberIds = await listConversationMemberUserIds(conversationId);
  } catch {
    memberIds = [];
  }

  if (latest) {
    const ts = latest.createdAt;
    const mid = latest.messageId;
    const msk = latest.SK;
    await docClient.send(
      new UpdateCommand({
        TableName: TableName(),
        Key: { PK: convPk(conversationId), SK: META_SK },
        UpdateExpression:
          "SET lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
        ExpressionAttributeValues: {
          ":ts": ts,
          ":mid": mid,
          ":msk": msk,
        },
      }),
    );
    const g2sk = gsi2InboxSk(ts, conversationId);
    await Promise.all(
      memberIds.map((uid) =>
        docClient.send(
          new UpdateCommand({
            TableName: TableName(),
            Key: { PK: userPk(uid), SK: userConvSk(conversationId) },
            UpdateExpression: [
              "SET lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
              ", GSI2PK = :g2pk, GSI2SK = :g2sk",
            ].join(" "),
            ExpressionAttributeValues: {
              ":ts": ts,
              ":mid": mid,
              ":msk": msk,
              ":g2pk": gsi2Pk(uid),
              ":g2sk": g2sk,
            },
          }),
        ),
      ),
    );
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: META_SK },
      UpdateExpression:
        "SET lastMessageAt = :ts, lastMessageId = :empty, lastMessageSK = :empty",
      ExpressionAttributeValues: {
        ":ts": fallbackAt,
        ":empty": "",
      },
    }),
  );
  const g2sk = gsi2InboxSk(fallbackAt, conversationId);
  await Promise.all(
    memberIds.map((uid) =>
      docClient.send(
        new UpdateCommand({
          TableName: TableName(),
          Key: { PK: userPk(uid), SK: userConvSk(conversationId) },
          UpdateExpression: [
            "SET lastMessageAt = :ts, lastMessageId = :empty, lastMessageSK = :empty",
            ", GSI2PK = :g2pk, GSI2SK = :g2sk",
            ", #tp = if_not_exists(#tp, :tp)",
          ].join(" "),
          ExpressionAttributeNames: { "#tp": "type" },
          ExpressionAttributeValues: {
            ":ts": fallbackAt,
            ":empty": "",
            ":g2pk": gsi2Pk(uid),
            ":g2sk": g2sk,
            ":tp": conversationType,
          },
        }),
      ),
    ),
  );
}

/**
 * Delete every message row (and S3 media) scoped to a group channel.
 */
async function deleteAllMessagesForChannel({ conversationId, channelId }) {
  const cid = String(conversationId || "").trim();
  const chId = String(channelId || "").trim();
  if (!cid.startsWith("GROUP#") || !chId) {
    return { deletedCount: 0 };
  }

  const items = await queryAllChannelMessageItems(cid, chId);
  if (items.length === 0) {
    return { deletedCount: 0 };
  }

  const metaRes = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(cid), SK: META_SK },
    }),
  );
  const meta = metaRes.Item;
  const skPrefix = channelMessageSkPrefix(chId);
  const needsInboxRefresh =
    !meta?.lastMessageSK ||
    String(meta.lastMessageSK).startsWith(skPrefix);

  const s3Keys = new Set();
  for (const it of items) {
    for (const k of collectS3KeysFromMessageItem(it)) {
      s3Keys.add(k);
    }
  }

  await batchDeleteMessageRows(items);

  for (const key of s3Keys) {
    try {
      await deleteObjectByKey(key);
    } catch (e) {
      console.error("deleteAllMessagesForChannel: S3 delete failed", {
        conversationId: cid,
        channelId: chId,
        key,
        error: e?.message,
      });
    }
  }

  if (needsInboxRefresh) {
    await refreshConversationLastMessageAfterDeletes(cid);
  }

  return { deletedCount: items.length };
}

async function recallMessage(messageId, userId) {
  const item = await getMessageById(messageId);
  if (!item) return null;
  if (item.senderId !== userId) {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }

  const keys = [];
  if (Array.isArray(item.mediaItems)) {
    for (const it of item.mediaItems) {
      const k = it?.s3Key;
      if (typeof k === "string" && k.length > 0) keys.push(k);
    }
  }

  for (const key of keys) {
    try {
      await deleteObjectByKey(key);
    } catch (e) {
      console.error("recallMessage: failed to delete S3 object", {
        messageId,
        key,
        error: e?.message,
      });
    }
  }

  const recalledAt = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression:
        "SET recallScope = :all, recalledAt = :ra REMOVE #txt, #medItems",
      ExpressionAttributeNames: {
        "#txt": "text",
        "#medItems": "mediaItems",
      },
      ExpressionAttributeValues: {
        ":all": "ALL",
        ":ra": recalledAt,
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const updated = await getMessageById(messageId);
  return messageToLegacy(updated, userId);
}

async function recallMessageMe(messageId, userId) {
  const item = await getMessageById(messageId);
  if (!item) return null;
  if (item.senderId !== userId) {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: "ADD hiddenFor :u",
      ExpressionAttributeValues: {
        ":u": new Set([String(userId)]),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const updated = await getMessageById(messageId);
  return messageToLegacy(updated, userId);
}

async function editMessageText(messageId, userId, nextTextRaw) {
  const item = await getMessageById(messageId);
  if (!item) return null;
  if (item.senderId !== userId) {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }
  if (item.recallScope === "ALL") {
    const err = new Error("MESSAGE_RECALLED");
    err.code = "MESSAGE_RECALLED";
    throw err;
  }

  const nextText = typeof nextTextRaw === "string" ? nextTextRaw.trim() : "";
  if (!nextText) {
    const err = new Error("INVALID_TEXT");
    err.code = "INVALID_TEXT";
    throw err;
  }

  const prevText = typeof item.text === "string" ? item.text : "";
  if (nextText === prevText) {
    // no-op: still return current shape
    return messageToLegacy(item, userId);
  }

  const editedAt = new Date().toISOString();
  const historyEntry = {
    editedAt,
    prevText,
    nextText,
  };

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: [
        "SET #txt = :t, editedAt = :ea",
        ", editHistory = list_append(if_not_exists(editHistory, :empty), :h)",
      ].join(" "),
      ExpressionAttributeNames: {
        "#txt": "text",
      },
      ExpressionAttributeValues: {
        ":t": nextText,
        ":ea": editedAt,
        ":empty": [],
        ":h": [historyEntry],
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  const updated = await getMessageById(messageId);
  return messageToLegacy(updated, userId);
}

async function forwardMessage({ senderId, receiverId, sourceMessageId }) {
  const src = await getMessageById(sourceMessageId);
  if (!src) {
    const err = new Error("MESSAGE_NOT_FOUND");
    err.code = "MESSAGE_NOT_FOUND";
    throw err;
  }
  if (src.recallScope === "ALL") {
    const err = new Error("MESSAGE_NOT_FOUND");
    err.code = "MESSAGE_NOT_FOUND";
    throw err;
  }
  const text = src.text;
  const mediaItems = Array.isArray(src.mediaItems) ? src.mediaItems : undefined;
  const images =
    src.type === "IMAGES" && mediaItems
      ? mediaItems.map((m) => ({
          fileUrl: m?.publicUrl,
          s3Key: m?.s3Key,
          mimeType: m?.contentType,
          fileName: m?.fileName,
          sizeBytes: m?.sizeBytes,
        }))
      : undefined;
  const single = mediaItems && mediaItems.length === 1 ? mediaItems[0] : null;
  const imageUrl =
    src.type === "IMAGE" && single ? single.publicUrl : undefined;
  const fileUrl = src.type === "FILE" && single ? single.publicUrl : undefined;
  return sendDirectMessage({
    senderId,
    receiverId,
    text,
    imageUrl,
    fileUrl,
    images,
    s3Key: single?.s3Key,
    mimeType: single?.contentType,
    fileName: single?.fileName,
    sizeBytes: single?.sizeBytes,
    isForwarded: true,
  });
}

function normalizeEmoji(input) {
  if (typeof input !== "string") return "";
  return input.trim();
}

async function reactToMessage(messageId, userId, emojiRaw) {
  const emoji = normalizeEmoji(emojiRaw);
  if (!emoji) {
    const err = new Error("INVALID_EMOJI");
    err.code = "INVALID_EMOJI";
    throw err;
  }

  const item = await getMessageById(messageId);
  if (!item) return null;
  if (item.recallScope === "ALL") {
    const err = new Error("MESSAGE_RECALLED");
    err.code = "MESSAGE_RECALLED";
    throw err;
  }
  if (item.senderId !== userId && item.receiverId !== userId) {
    const err = new Error("NOT_ALLOWED");
    err.code = "NOT_ALLOWED";
    throw err;
  }

  const current = item.reactionsByEmoji || {};
  const existing = current[emoji];
  const hasReacted =
    (existing instanceof Set && existing.has(String(userId))) ||
    (Array.isArray(existing) && existing.includes(String(userId)));

  // We'll store as DynamoDB String Set for uniqueness.
  const pathName = "#r.#e";
  const ExpressionAttributeNames = { "#r": "reactionsByEmoji", "#e": emoji };
  const ExpressionAttributeValues = { ":u": new Set([String(userId)]) };

  const UpdateExpression = hasReacted
    ? `DELETE ${pathName} :u`
    : `ADD ${pathName} :u`;

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  const updated = await getMessageById(messageId);
  return messageToLegacy(updated, userId);
}

function buildSearchSnippet(text, needle, maxLen = 80) {
  const t = String(text || "");
  const n = String(needle || "").trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  const idx = n ? lower.indexOf(n.toLowerCase()) : -1;
  if (idx < 0) {
    return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  }
  const half = Math.floor((maxLen - n.length) / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(t.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < t.length ? "…" : "";
  return `${prefix}${t.slice(start, end)}${suffix}`;
}

function messageMatchesSearch(msg, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return false;
  if (!msg || msg.isRecalled || msg.isDeletedForMe || msg.isSystem) return false;
  const text = String(msg.text || "").trim();
  if (!text) return false;
  return text.toLowerCase().includes(q.toLowerCase());
}

/** Search message text in a DM or across all channels in a group. */
async function searchConversationMessages(viewerId, conversationId, query, options = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const limit = Math.min(50, Math.max(1, Number(options.limit) || 30));
  const cid = String(conversationId || "");

  let rows = [];
  if (cid.startsWith("DM#")) {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": "MSG#",
        },
        ScanIndexForward: false,
      }),
    );
    rows = (res.Items || []).filter((it) => {
      const sk = String(it.SK || "");
      return sk.startsWith("MSG#") && !sk.startsWith("MSG#CH#");
    });
  } else if (cid.startsWith("GROUP#")) {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :ms)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":ms": "MSG#CH#",
        },
        ScanIndexForward: false,
      }),
    );
    rows = res.Items || [];
  } else {
    return [];
  }

  const matched = rows
    .map((it) => messageToLegacy(it, viewerId))
    .filter((m) => m && messageMatchesSearch(m, q));

  matched.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );

  let channelNameById = {};
  if (cid.startsWith("GROUP#")) {
    const channels = await listChannels({ conversationId, userId: viewerId });
    for (const ch of channels || []) {
      if (ch?.channelId) {
        channelNameById[String(ch.channelId)] = String(ch.name || "");
      }
    }
  }

  return matched.slice(0, limit).map((m) => {
    const channelId = m.channelId ? String(m.channelId) : undefined;
    return {
      messageId: m._id,
      text: m.text,
      createdAt: m.createdAt,
      senderId: m.senderId,
      snippet: buildSearchSnippet(m.text, q),
      ...(channelId
        ? {
            channelId,
            channelName: channelNameById[channelId] || "",
          }
        : {}),
    };
  });
}

module.exports = {
  messageToLegacy,
  listDirectMessages,
  sendDirectMessage,
  listConversationMessages,
  sendConversationMessage,
  getMessageById,
  deleteAllMessagesForChannel,
  recallMessage,
  recallMessageMe,
  editMessageText,
  forwardMessage,
  reactToMessage,
  searchConversationMessages,
};
