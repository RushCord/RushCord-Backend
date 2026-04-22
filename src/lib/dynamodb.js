const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || "ap-southeast-1";
const rawClient = new DynamoDBClient({ region });

const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

function getTableName() {
  return process.env.DYNAMODB_TABLE_NAME || "ott";
}

module.exports = {
  docClient,
  getTableName,
};
