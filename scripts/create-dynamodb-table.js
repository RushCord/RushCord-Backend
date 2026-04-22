/**
 * One-shot: create single-table `ott` with GSI1 + GSI2 (see newDatabaseDiagram.md).
 * Usage: node scripts/create-dynamodb-table.js
 * Requires: AWS credentials + AWS_REGION + DYNAMODB_TABLE_NAME (default ott) in env.
 */
require("dotenv").config();
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} = require("@aws-sdk/client-dynamodb");

const TableName = process.env.DYNAMODB_TABLE_NAME || "ott";
const client = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-southeast-1" });

async function main() {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    console.log(`Table "${TableName}" already exists.`);
    return;
  } catch (e) {
    if (e.name !== "ResourceNotFoundException") throw e;
  }

  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
        { AttributeName: "GSI2PK", AttributeType: "S" },
        { AttributeName: "GSI2SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "GSI2",
          KeySchema: [
            { AttributeName: "GSI2PK", KeyType: "HASH" },
            { AttributeName: "GSI2SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );

  console.log(`Created table "${TableName}". Wait until ACTIVE before starting the API.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
