import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || "ap-southeast-1";
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

function userPk(userId) {
  return `USER#${userId}`;
}
const PROFILE_SK = "PROFILE";
function emailPk(email) {
  return `EMAIL#${String(email).trim().toLowerCase()}`;
}
const EMAIL_REF_SK = "REF";

/**
 * PostConfirmation_ConfirmSignUp: create RushCord PROFILE + EmailRef (userId = Cognito sub).
 * Env: TABLE_NAME (required)
 */
export const handler = async (event) => {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error("TABLE_NAME env is not set");
  }

  const attrs = event.request.userAttributes || {};
  const sub = attrs.sub;
  const emailRaw = attrs.email ?? "";
  const fullName = (attrs.name ?? "").trim() || emailRaw.split("@")[0] || "User";

  if (!sub) {
    console.error("post-confirmation: missing sub");
    return event;
  }

  const email = emailRaw.trim().toLowerCase();
  if (!email) {
    console.error("post-confirmation: missing email");
    return event;
  }

  const now = new Date().toISOString();
  const profile = {
    PK: userPk(sub),
    SK: PROFILE_SK,
    entityType: "User",
    userId: sub,
    fullName,
    email,
    avatarUrl: "",
    userName: email.split("@")[0],
    createdAt: now,
    updatedAt: now,
  };
  const emailRef = {
    PK: emailPk(email),
    SK: EMAIL_REF_SK,
    entityType: "EmailRef",
    userId: sub,
    email,
  };

  try {
    const existing = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: userPk(sub), SK: PROFILE_SK },
      })
    );
    if (existing.Item?.userId === sub) {
      console.log("post-confirmation: profile already exists (idempotent), sub=%s", sub);
      return event;
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: profile,
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: emailRef,
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      })
    );
  } catch (err) {
    const name = err?.name || "";
    if (name === "TransactionCanceledException") {
      const again = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: userPk(sub), SK: PROFILE_SK },
        })
      );
      if (again.Item?.userId === sub) {
        console.log(
          "post-confirmation: race resolved, profile exists, sub=%s",
          sub
        );
        return event;
      }
    }
    console.error("post-confirmation: TransactWrite failed", err);
    throw err;
  }

  return event;
};
