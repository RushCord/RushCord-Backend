/** Single-table key helpers (newDatabaseDiagram.md) */

function userPk(userId) {
  return `USER#${userId}`;
}

const PROFILE_SK = "PROFILE";

function emailPk(email) {
  return `EMAIL#${String(email).trim().toLowerCase()}`;
}

const EMAIL_REF_SK = "REF";

const EMAIL_CHANGE_SK = "EMAIL_CHANGE";

function emailChangeTokenPk(tokenHash) {
  return `EMAIL_CHANGE_TOKEN#${tokenHash}`;
}

function convPk(conversationId) {
  return `CONV#${conversationId}`;
}

const META_SK = "META";

function memberSk(userId) {
  return `MEMBER#${userId}`;
}

function userConvSk(conversationId) {
  return `CONV#${conversationId}`;
}

/** Stable DM conversation id from two user ids (lexicographic order). */
function dmConversationId(userIdA, userIdB) {
  const [a, b] = [userIdA, userIdB].sort();
  return `DM#${a}#${b}`;
}

function messageSk(createdAtIso, messageId) {
  return `MSG#${createdAtIso}#${messageId}`;
}

/** Group/DM message row tied to a text/media channel (INFO or CHAT). */
function channelMessageSk(channelId, createdAtIso, messageId) {
  return `MSG#CH#${channelId}#${createdAtIso}#${messageId}`;
}

function channelMessageSkPrefix(channelId) {
  return `MSG#CH#${channelId}#`;
}

/** Channel entity: CHANNEL#INFO|CHAT|VOICE#<channelId> */
function channelSk(channelType, channelId) {
  return `CHANNEL#${String(channelType).toUpperCase()}#${channelId}`;
}

/** Socket / LiveKit room for a voice channel within a group. */
function groupVoiceRoomName(conversationId, voiceChannelId) {
  const cid = String(conversationId || "").trim();
  const vid = String(voiceChannelId || "").trim();
  return `${cid}#VOICE#${vid}`;
}

/** Socket room for typing/newMessage scoped to a text channel. */
function conversationChannelSocketRoom(conversationId, channelId) {
  const cid = String(conversationId || "").trim();
  const ch = String(channelId || "").trim();
  return `${cid}#CH#${ch}`;
}

function gsi1MessagePk(messageId) {
  return `MSG#${messageId}`;
}

function gsi1MessageSk(conversationId, createdAtIso, messageId) {
  const sk = messageSk(createdAtIso, messageId);
  return `CONV#${conversationId}#SK#${sk}`;
}

/** GSI1SK for any message row SK (DM legacy or group channel-scoped). */
function gsi1MessageSkForRow(conversationId, rowSk) {
  return `CONV#${conversationId}#SK#${rowSk}`;
}

function gsi2Pk(userId) {
  return `USER#${userId}`;
}

function gsi2InboxSk(lastMessageAtIso, conversationId) {
  return `INBOX#${lastMessageAtIso}#CONV#${conversationId}`;
}

function inviteSk(inviteId) {
  return `INVITE#${String(inviteId)}`;
}

function inviteLookupPk(codeHash) {
  return `INVITE#${String(codeHash)}`;
}

module.exports = {
  userPk,
  PROFILE_SK,
  emailPk,
  EMAIL_REF_SK,
  EMAIL_CHANGE_SK,
  emailChangeTokenPk,
  convPk,
  META_SK,
  memberSk,
  userConvSk,
  dmConversationId,
  messageSk,
  channelMessageSk,
  channelMessageSkPrefix,
  channelSk,
  groupVoiceRoomName,
  conversationChannelSocketRoom,
  gsi1MessagePk,
  gsi1MessageSk,
  gsi1MessageSkForRow,
  gsi2Pk,
  gsi2InboxSk,
  inviteSk,
  inviteLookupPk,
};
