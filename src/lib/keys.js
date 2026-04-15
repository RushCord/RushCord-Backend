/** Single-table key helpers (newDatabaseDiagram.md) */

function userPk(userId) {
  return `USER#${userId}`;
}

const PROFILE_SK = "PROFILE";

function emailPk(email) {
  return `EMAIL#${String(email).trim().toLowerCase()}`;
}

const EMAIL_REF_SK = "REF";

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

function gsi1MessagePk(messageId) {
  return `MSG#${messageId}`;
}

function gsi1MessageSk(conversationId, createdAtIso, messageId) {
  const sk = messageSk(createdAtIso, messageId);
  return `CONV#${conversationId}#SK#${sk}`;
}

function gsi2Pk(userId) {
  return `USER#${userId}`;
}

function gsi2InboxSk(lastMessageAtIso, conversationId) {
  return `INBOX#${lastMessageAtIso}#CONV#${conversationId}`;
}

module.exports = {
  userPk,
  PROFILE_SK,
  emailPk,
  EMAIL_REF_SK,
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
};
