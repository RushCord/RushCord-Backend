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
