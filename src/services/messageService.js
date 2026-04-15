const { randomUUID } = require("crypto");
const {
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  userPk,
  PROFILE_SK,
  convPk,
  META_SK,
  memberSk,
  userConvSk,
  dmConversationId,
  messageSk,
  gsi1MessagePk,
  gsi1MessageSk,
  gsi2Pk,
  gsi2InboxSk,
} = require("../lib/keys");
const { getProfileRaw } = require("./userService");
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
  const dto = {
    _id: item.messageId,
    senderId: item.senderId,
    receiverId: item.receiverId,
    isForwarded: !!item.isForwarded,
    isRecalled: recalled,
    isDeletedForMe: deletedForMe,
    createdAt: item.createdAt,
  };
  if (!recalled && !deletedForMe) {
    if (item.text) dto.text = item.text;
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

module.exports = {
  messageToLegacy,
  listDirectMessages,
  sendDirectMessage,
  getMessageById,
  recallMessage,
  recallMessageMe,
  forwardMessage,
};
