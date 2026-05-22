const crypto = require("crypto");
const { randomUUID } = require("crypto");
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const {
  convPk,
  META_SK,
  memberSk,
  userPk,
  userConvSk,
  gsi2Pk,
  gsi2InboxSk,
  inviteSk,
  inviteLookupPk,
} = require("../lib/keys");
const { getProfileRaw } = require("./userService");
const { getConversationMeta } = require("./conversationsService");
const { getConversationMember } = require("./conversationService");
const {
  normalizeJoinPolicy,
  getEffectiveJoinPolicy,
} = require("../constants/groupJoinPolicy");

const TableName = () => getTableName();

function hashInviteCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateInviteCode() {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_BASE_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

function inviteIsUsable(item) {
  if (!item || item.revoked) return false;
  if (isExpired(item.expiresAt)) return false;
  const max = item.maxUses;
  if (max != null && Number(item.usesCount || 0) >= Number(max)) return false;
  return true;
}

function invitePlainCode(item) {
  return item?._plainCode || item?.inviteCode || null;
}

function toInviteDto(item, { forAdmin = false } = {}) {
  if (!item) return null;
  const code = invitePlainCode(item);
  const includeLink = forAdmin && code && !item.revoked;
  return {
    inviteId: item.inviteId,
    conversationId: item.conversationId,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt ?? null,
    maxUses: item.maxUses ?? null,
    usesCount: item.usesCount ?? 0,
    revoked: Boolean(item.revoked),
    revokedAt: item.revokedAt || null,
    canJoin: inviteIsUsable(item),
    ...(includeLink
      ? {
          code,
          url: `${frontendBaseUrl()}/invite/${encodeURIComponent(code)}`,
        }
      : {}),
  };
}

function resolveExpiresAt({ expiresAt, expiresInHours }) {
  const hasExpiresAt = expiresAt !== undefined && expiresAt !== null && expiresAt !== "";
  if (hasExpiresAt) {
    if (expiresAt === false) return null;
    const t = new Date(expiresAt).getTime();
    if (!Number.isFinite(t)) {
      const err = new Error("INVALID_EXPIRES_AT");
      err.code = "INVALID_EXPIRES_AT";
      throw err;
    }
    if (t <= Date.now()) {
      const err = new Error("INVALID_EXPIRES_AT");
      err.code = "INVALID_EXPIRES_AT";
      throw err;
    }
    return new Date(t).toISOString();
  }
  const hours = Number(expiresInHours);
  if (Number.isFinite(hours) && hours > 0) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }
  return null;
}

async function getInviteLookupByCode(code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) return null;
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: inviteLookupPk(hashInviteCode(trimmed)), SK: META_SK },
    }),
  );
  return res.Item || null;
}

async function getInviteCanonical(conversationId, inviteId) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: inviteSk(inviteId) },
    }),
  );
  return res.Item || null;
}

function buildInviteRecords({
  inviteId,
  conversationId,
  codeHash,
  inviteCode,
  createdBy,
  createdAt,
  expiresAt,
  maxUses,
}) {
  const base = {
    entityType: "GroupInvite",
    inviteId,
    conversationId,
    codeHash,
    inviteCode: String(inviteCode),
    createdBy: String(createdBy),
    createdAt,
    expiresAt: expiresAt ?? null,
    maxUses: maxUses ?? null,
    usesCount: 0,
    revoked: false,
  };
  return {
    canonical: {
      PK: convPk(conversationId),
      SK: inviteSk(inviteId),
      ...base,
    },
    lookup: {
      PK: inviteLookupPk(codeHash),
      SK: META_SK,
      entityType: "GroupInviteLookup",
      ...base,
    },
  };
}

async function createGroupInvite({
  conversationId,
  actorId,
  expiresInHours,
  expiresAt: expiresAtInput,
  maxUses,
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

  const expiresAt = resolveExpiresAt({
    expiresAt: expiresAtInput,
    expiresInHours,
  });

  let maxUsesVal = null;
  const mu = Number(maxUses);
  if (Number.isFinite(mu) && mu > 0) {
    maxUsesVal = Math.floor(mu);
  }

  const inviteId = randomUUID();
  const createdAt = new Date().toISOString();
  const table = TableName();

  for (let attempt = 0; attempt < 3; attempt++) {
    const plainCode = generateInviteCode();
    const codeHash = hashInviteCode(plainCode);
    const { canonical, lookup } = buildInviteRecords({
      inviteId,
      conversationId,
      codeHash,
      inviteCode: plainCode,
      createdBy: actorId,
      createdAt,
      expiresAt,
      maxUses: maxUsesVal,
    });

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: table,
                Item: canonical,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: table,
                Item: lookup,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );

      return toInviteDto(
        { ...canonical, inviteCode: plainCode },
        { forAdmin: true },
      );
    } catch (e) {
      if (e.name === "TransactionCanceledException" && attempt < 2) {
        continue;
      }
      throw e;
    }
  }

  const err = new Error("INVITE_CREATE_FAILED");
  err.code = "INVITE_CREATE_FAILED";
  throw err;
}

async function listGroupInvites(conversationId) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": convPk(conversationId),
          ":prefix": "INVITE#",
        },
        ExclusiveStartKey,
      }),
    );
    out.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return out
    .filter((it) => it.entityType === "GroupInvite" || String(it.SK || "").startsWith("INVITE#"))
    .map((it) => toInviteDto(it, { forAdmin: true }))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function revokeGroupInvite({ conversationId, inviteId }) {
  const canonical = await getInviteCanonical(conversationId, inviteId);
  if (!canonical) {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }
  if (canonical.revoked) {
    return toInviteDto(canonical);
  }

  const now = new Date().toISOString();
  const table = TableName();

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: convPk(conversationId), SK: inviteSk(inviteId) },
      UpdateExpression: "SET revoked = :r, revokedAt = :t",
      ExpressionAttributeValues: { ":r": true, ":t": now },
    }),
  );

  if (canonical.codeHash) {
    await docClient.send(
      new DeleteCommand({
        TableName: table,
        Key: { PK: inviteLookupPk(canonical.codeHash), SK: META_SK },
      }),
    );
  }

  return toInviteDto({ ...canonical, revoked: true, revokedAt: now });
}

async function getInvitePreview(code) {
  const lookup = await getInviteLookupByCode(code);
  if (!lookup) {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }

  const meta = await getConversationMeta(lookup.conversationId);
  if (!meta || meta.type !== "GROUP") {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }

  const usable = inviteIsUsable(lookup);
  let status = "valid";
  if (lookup.revoked) status = "revoked";
  else if (isExpired(lookup.expiresAt)) status = "expired";
  else if (
    lookup.maxUses != null &&
    Number(lookup.usesCount || 0) >= Number(lookup.maxUses)
  ) {
    status = "max_uses";
  }

  return {
    title: meta.title || "",
    avatar: meta.avatar || "",
    memberCount: meta.memberCount ?? 0,
    joinPolicy: getEffectiveJoinPolicy(meta),
    expiresAt: lookup.expiresAt ?? null,
    maxUses: lookup.maxUses ?? null,
    usesCount: lookup.usesCount ?? 0,
    status,
    canJoin: usable,
  };
}

function buildInviteUseCondition(maxUses) {
  const condParts = ["revoked = :f", "attribute_exists(PK)"];
  const values = { ":one": 1, ":f": false };
  if (maxUses != null) {
    condParts.push("usesCount < :max");
    values[":max"] = Number(maxUses);
  }
  return { condParts, values };
}

async function acceptGroupInvite({ code, userId }) {
  const lookup = await getInviteLookupByCode(code);
  if (!lookup) {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }
  if (lookup.revoked) {
    const err = new Error("INVITE_REVOKED");
    err.code = "INVITE_REVOKED";
    throw err;
  }
  if (isExpired(lookup.expiresAt)) {
    const err = new Error("INVITE_EXPIRED");
    err.code = "INVITE_EXPIRED";
    throw err;
  }
  if (
    lookup.maxUses != null &&
    Number(lookup.usesCount || 0) >= Number(lookup.maxUses)
  ) {
    const err = new Error("INVITE_MAX_USES");
    err.code = "INVITE_MAX_USES";
    throw err;
  }

  const conversationId = lookup.conversationId;
  const meta = await getConversationMeta(conversationId);
  if (!meta || meta.type !== "GROUP") {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }

  const existing = await getConversationMember({ conversationId, userId });
  if (existing) {
    return {
      conversationId,
      type: "GROUP",
      title: meta.title || "",
      avatar: meta.avatar || "",
      topic: meta.topic || "",
      description: meta.description || "",
      cover: meta.cover || "",
      joinPolicy: getEffectiveJoinPolicy(meta),
      alreadyMember: true,
    };
  }

  const profile = await getProfileRaw(userId);
  if (!profile) {
    const err = new Error("USER_NOT_FOUND");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const now = new Date().toISOString();
  const table = TableName();
  const { condParts, values: inviteCondValues } = buildInviteUseCondition(
    lookup.maxUses,
  );

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
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
              TableName: table,
              Item: {
                PK: userPk(userId),
                SK: userConvSk(conversationId),
                entityType: "UserConversation",
                userId: String(userId),
                conversationId,
                type: "GROUP",
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
              TableName: table,
              Key: { PK: convPk(conversationId), SK: META_SK },
              UpdateExpression: "SET updatedAt = :u ADD memberCount :one",
              ExpressionAttributeValues: { ":u": now, ":one": 1 },
            },
          },
          {
            Update: {
              TableName: table,
              Key: {
                PK: inviteLookupPk(lookup.codeHash),
                SK: META_SK,
              },
              UpdateExpression: "ADD usesCount :one",
              ConditionExpression: condParts.join(" AND "),
              ExpressionAttributeValues: inviteCondValues,
            },
          },
          {
            Update: {
              TableName: table,
              Key: {
                PK: convPk(conversationId),
                SK: inviteSk(lookup.inviteId),
              },
              UpdateExpression: "ADD usesCount :one",
              ConditionExpression: condParts.join(" AND "),
              ExpressionAttributeValues: inviteCondValues,
            },
          },
        ],
      }),
    );
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const err = new Error("INVITE_MAX_USES");
      err.code = "INVITE_MAX_USES";
      throw err;
    }
    throw e;
  }

  return {
    conversationId,
    type: "GROUP",
    title: meta.title || "",
    avatar: meta.avatar || "",
    topic: meta.topic || "",
    description: meta.description || "",
    cover: meta.cover || "",
    joinPolicy: getEffectiveJoinPolicy(meta),
    userId: String(userId),
    fullName: profile.fullName,
    role: "MEMBER",
    joinedAt: now,
    alreadyMember: false,
  };
}

module.exports = {
  createGroupInvite,
  listGroupInvites,
  revokeGroupInvite,
  getInvitePreview,
  acceptGroupInvite,
};
