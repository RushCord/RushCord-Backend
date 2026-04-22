const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient, getTableName } = require("../lib/dynamodb");
const { convPk, memberSk } = require("../lib/keys");

const TableName = () => getTableName();

async function getConversationMember({ conversationId, userId }) {
  const res = await docClient.send(
    new GetCommand({
      TableName: TableName(),
      Key: { PK: convPk(conversationId), SK: memberSk(userId) },
    }),
  );
  return res.Item || null;
}

async function assertUserInConversation({ conversationId, userId }) {
  const member = await getConversationMember({ conversationId, userId });
  if (!member) {
    const err = new Error("NOT_IN_CONVERSATION");
    err.code = "NOT_IN_CONVERSATION";
    throw err;
  }
  if (member.status && member.status !== "ACCEPTED") {
    const err = new Error("CONVERSATION_NOT_ACCEPTED");
    err.code = "CONVERSATION_NOT_ACCEPTED";
    throw err;
  }
  return member;
}

module.exports = {
  getConversationMember,
  assertUserInConversation,
};

