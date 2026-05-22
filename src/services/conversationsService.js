const { randomUUID } = require("crypto");
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const { convPk, META_SK, memberSk, userPk, userConvSk, gsi2Pk, gsi2InboxSk } = require("../lib/keys");
const { getProfileRaw } = require("./userService");
const { seedDefaultChannelsForNewGroup, listChannels } = require("./channelsService");
const { listConversationMessages } = require("./messageService");
const {
  assertAllowedTopic,
  isAllowedTopicId,
  normalizeGroupDescription,
} = require("../constants/groupTopics");
const { getConversationMember } = require("./conversationService");
const { getEffectiveJoinPolicy } = require("../constants/groupJoinPolicy");

const TableName = () => getTableName();

function toConversationDto({ meta, inbox, lastMessage }) {
  if (!meta && !inbox) return null;
  const type = meta?.type || inbox?.type || "DM";
  return {
    conversationId: meta?.conversationId || inbox?.conversationId,
    type,
    title: type === "GROUP" ? meta?.title || "" : meta?.title, // DM title optional
    avatar: meta?.avatar || "",
    cover: meta?.cover || "",
    ...(type === "GROUP"
      ? {
          topic: meta?.topic || "",
          description: meta?.description || "",
          joinPolicy: getEffectiveJoinPolicy(meta),
        }
      : {}),
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

async function createGroupConversation({
  creatorId,
  title,
  memberIds,
  topic,
  description,
  avatar,
  cover,
}) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) {
    const err = new Error("INVALID_TITLE");
    err.code = "INVALID_TITLE";
    throw err;
  }
  const topicId = assertAllowedTopic(topic);
  const descriptionText = normalizeGroupDescription(description);
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
    topic: topicId,
    description: descriptionText,
    avatar: typeof avatar === "string" ? avatar.trim() : "",
    cover: typeof cover === "string" ? cover.trim() : "",
    createdAt: now,
    createdBy: String(creatorId),
    lastMessageAt: now,
    lastMessageId: "",
    lastMessageSK: "",
    memberCount: allMembers.length,
    joinPolicy: "OPEN",
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

  await seedDefaultChannelsForNewGroup({
    conversationId,
    createdBy: String(creatorId),
  });

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
  cover,
  joinPolicy,
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
  const nextCover =
    cover === undefined ? undefined : String(cover || "").trim();
  const nextJoinPolicy =
    joinPolicy === undefined
      ? undefined
      : getEffectiveJoinPolicy({ joinPolicy });

  if (
    nextTitle === undefined &&
    nextAvatar === undefined &&
    nextCover === undefined &&
    nextJoinPolicy === undefined
  ) {
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
  if (nextCover !== undefined) {
    sets.push("#c = :c");
    names["#c"] = "cover";
    values[":c"] = nextCover;
  }
  if (nextJoinPolicy !== undefined) {
    sets.push("joinPolicy = :jp");
    values[":jp"] = nextJoinPolicy;
  }
  sets.push("updatedAt = :u");
  values[":u"] = new Date().toISOString();

  const updateParams = {
    TableName: TableName(),
    Key: { PK: convPk(conversationId), SK: META_SK },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeValues: values,
  };
  if (Object.keys(names).length > 0) {
    updateParams.ExpressionAttributeNames = names;
  }
  await docClient.send(new UpdateCommand(updateParams));

  return (await getConversationMeta(conversationId)) || meta;
}

function effectiveAdminGrantedAt(member) {
  const raw =
    member?.adminGrantedAt || member?.updatedAt || member?.joinedAt || "";
  return String(raw);
}

function pickLongestTenuredAdmin(members) {
  const admins = (Array.isArray(members) ? members : [])
    .filter((m) => String(m.role || "").toUpperCase() === "ADMIN")
    .filter((m) => {
      const st = String(m.status || "ACCEPTED").toUpperCase();
      return st === "ACCEPTED";
    });
  if (admins.length === 0) {
    const err = new Error("NO_ELIGIBLE_SUCCESSOR");
    err.code = "NO_ELIGIBLE_SUCCESSOR";
    throw err;
  }
  admins.sort((a, b) => {
    const ta = effectiveAdminGrantedAt(a);
    const tb = effectiveAdminGrantedAt(b);
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.userId).localeCompare(String(b.userId));
  });
  return admins[0];
}

async function updateConversationMemberRole({ conversationId, userId, nextRole }) {
  const role = String(nextRole || "").trim().toUpperCase();
  if (role !== "MEMBER" && role !== "ADMIN") {
    const err = new Error("INVALID_ROLE");
    err.code = "INVALID_ROLE";
    throw err;
  }
  const updatedAt = new Date().toISOString();
  const adminGrantedAt = updatedAt;
  const updateExpression =
    role === "ADMIN"
      ? "SET #r = :r, updatedAt = :u, adminGrantedAt = :aga"
      : "SET #r = :r, updatedAt = :u REMOVE adminGrantedAt";
  const expressionAttributeValues =
    role === "ADMIN"
      ? { ":r": role, ":u": updatedAt, ":aga": adminGrantedAt }
      : { ":r": role, ":u": updatedAt };

  await docClient.send(
    new UpdateCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: memberSk(userId) },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { "#r": "role" },
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
  return role === "ADMIN"
    ? { userId, role, updatedAt, adminGrantedAt }
    : { userId, role, updatedAt };
}

async function leaveGroupAsOwner({ conversationId, userId }) {
  const members = await listConversationMembers(conversationId);
  const ownerMember = members.find((m) => String(m.userId) === String(userId));
  if (!ownerMember || String(ownerMember.role || "").toUpperCase() !== "OWNER") {
    const err = new Error("NOT_OWNER");
    err.code = "NOT_OWNER";
    throw err;
  }

  const successor = pickLongestTenuredAdmin(members);
  const successorId = String(successor.userId);
  const now = new Date().toISOString();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TableName(),
            Key: { PK: convPk(conversationId), SK: memberSk(successorId) },
            UpdateExpression: "SET #r = :r, updatedAt = :u REMOVE adminGrantedAt",
            ExpressionAttributeNames: { "#r": "role" },
            ExpressionAttributeValues: { ":r": "OWNER", ":u": now },
            ConditionExpression: "attribute_exists(PK)",
          },
        },
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
            UpdateExpression: "SET updatedAt = :u ADD memberCount :negOne",
            ExpressionAttributeValues: {
              ":u": now,
              ":negOne": -1,
            },
          },
        },
      ],
    }),
  );

  return {
    userId: String(userId),
    removed: true,
    updatedAt: now,
    newOwnerId: successorId,
    newOwnerFullName: successor.fullName || successorId,
  };
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

function toPublicGroupExplore(meta, isMember) {
  if (!meta || meta.type !== "GROUP") return null;
  return {
    conversationId: meta.conversationId,
    title: meta.title || "",
    topic: meta.topic || "",
    description: meta.description || "",
    avatar: meta.avatar || "",
    cover: meta.cover || "",
    memberCount: meta.memberCount ?? 0,
    createdAt: meta.createdAt || null,
    isMember: Boolean(isMember),
  };
}

async function listAllGroupMetas() {
  const out = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TableName(),
        FilterExpression: "SK = :meta AND #t = :group",
        ExpressionAttributeNames: { "#t": "type" },
        ExpressionAttributeValues: {
          ":meta": META_SK,
          ":group": "GROUP",
        },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items || []) {
      if (item.entityType === "ConversationMeta" || item.conversationId) {
        out.push(item);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function searchGroupsForExplore(viewerId, query, topic, limit = 40) {
  const cap = Math.min(80, Math.max(1, Number(limit) || 40));
  const topicId = typeof topic === "string" ? topic.trim() : "";
  if (topicId && !isAllowedTopicId(topicId)) {
    const err = new Error("INVALID_TOPIC");
    err.code = "INVALID_TOPIC";
    throw err;
  }

  const needle = String(query || "").trim().toLowerCase();
  const userGroups = await listUserConversations({ userId: viewerId, limit: 100 });
  const memberIds = new Set(
    userGroups.filter((c) => c?.type === "GROUP").map((c) => String(c.conversationId)),
  );

  let groups = await listAllGroupMetas();
  groups = groups.filter((g) => getEffectiveJoinPolicy(g) !== "INVITE_ONLY");
  if (topicId) {
    groups = groups.filter((g) => String(g.topic || "") === topicId);
  }
  if (needle) {
    groups = groups.filter((g) => {
      const title = String(g.title || "").toLowerCase();
      const desc = String(g.description || "").toLowerCase();
      return title.includes(needle) || desc.includes(needle);
    });
  }

  return groups
    .map((meta) => toPublicGroupExplore(meta, memberIds.has(String(meta.conversationId))))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, cap);
}

const EXPLORE_PREVIEW_MESSAGE_LIMIT = 50;

async function getGroupExplorePreview(viewerId, conversationId) {
  const cid = String(conversationId || "").trim();
  const meta = await getConversationMeta(cid);
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
  if (getEffectiveJoinPolicy(meta) === "INVITE_ONLY") {
    const err = new Error("GROUP_NOT_DISCOVERABLE");
    err.code = "GROUP_NOT_DISCOVERABLE";
    throw err;
  }

  const member = await getConversationMember({ conversationId: cid, userId: viewerId });
  const isMember = Boolean(member);

  const channels = await listChannels({
    conversationId: cid,
    userId: viewerId,
  });
  const infoChannels = channels.filter((c) => c.channelType === "INFO");

  const infoWithMessages = await Promise.all(
    infoChannels.map(async (ch) => {
      const messages = await listConversationMessages(
        viewerId,
        cid,
        ch.channelId,
        { limit: EXPLORE_PREVIEW_MESSAGE_LIMIT },
      );
      return {
        channelId: ch.channelId,
        name: ch.name,
        messages,
      };
    }),
  );

  return {
    conversationId: cid,
    title: meta.title || "",
    description: meta.description || "",
    avatar: meta.avatar || "",
    cover: meta.cover || "",
    topic: meta.topic || "",
    memberCount: meta.memberCount ?? 0,
    createdAt: meta.createdAt || null,
    isMember,
    infoChannels: infoWithMessages,
  };
}

async function joinGroupConversation({ conversationId, userId }) {
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
  if (getEffectiveJoinPolicy(meta) === "INVITE_ONLY") {
    const err = new Error("INVITE_ONLY_GROUP");
    err.code = "INVITE_ONLY_GROUP";
    throw err;
  }

  const existing = await getConversationMember({ conversationId, userId });
  if (existing) {
    return {
      userId: String(userId),
      fullName: existing.fullName,
      role: existing.role,
      joinedAt: existing.joinedAt,
      alreadyMember: true,
    };
  }
  const out = await addConversationMember({ conversationId, userId });
  return { ...out, alreadyMember: false };
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
  leaveGroupAsOwner,
  effectiveAdminGrantedAt,
  pickLongestTenuredAdmin,
  addConversationMember,
  searchGroupsForExplore,
  getGroupExplorePreview,
  joinGroupConversation,
  dissolveGroupConversation,
};

