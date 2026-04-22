const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { getTableName } = require("./dynamodb");

module.exports = {
  connectDB: async () => {
    try {
      const region = process.env.AWS_REGION || "ap-southeast-1";
      const table = getTableName();
      const client = new DynamoDBClient({ region });
      await client.send(new DescribeTableCommand({ TableName: table }));
      console.log(`DynamoDB table OK: ${table} (${region})`);
    } catch (error) {
      console.error("DynamoDB connection check failed:", error.message);
    }
  },
};
