import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { SQSHandler } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

type MessageCreatedEvent = {
  eventType: "MESSAGE_CREATED";
  conversationId: string;
  messageId: string;
  createdAt: string;
  messageSK: string;
  senderId?: string;
};

function convPk(conversationId: string) {
  return `CONV#${conversationId}`;
}

function userPk(userId: string) {
  return `USER#${userId}`;
}

function userConvSk(conversationId: string) {
  return `CONV#${conversationId}`;
}

function gsi2InboxSk(lastMessageAtIso: string, conversationId: string) {
  return `INBOX#${lastMessageAtIso}#CONV#${conversationId}`;
}

async function listMemberUserIds(tableName: string, conversationId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :m)",
      ExpressionAttributeValues: {
        ":pk": convPk(conversationId),
        ":m": "MEMBER#",
      },
      ProjectionExpression: "userId, SK",
    })
  );

  const ids = new Set<string>();
  for (const it of res.Items || []) {
    const uid = typeof it.userId === "string" ? it.userId : undefined;
    if (uid) ids.add(uid);
  }
  return [...ids];
}

async function updateInboxRow({
  tableName,
  userId,
  conversationId,
  createdAt,
  messageId,
  messageSK,
}: {
  tableName: string;
  userId: string;
  conversationId: string;
  createdAt: string;
  messageId: string;
  messageSK: string;
}) {
  const g2sk = gsi2InboxSk(createdAt, conversationId);

  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: userPk(userId), SK: userConvSk(conversationId) },
      UpdateExpression: [
        "SET conversationId = if_not_exists(conversationId, :cid)",
        ", userId = if_not_exists(userId, :uid)",
        ", lastMessageAt = :ts, lastMessageId = :mid, lastMessageSK = :msk",
        ", GSI2PK = :g2pk, GSI2SK = :g2sk",
      ].join(" "),
      ConditionExpression:
        "attribute_not_exists(lastMessageSK) OR :msk > lastMessageSK",
      ExpressionAttributeValues: {
        ":cid": conversationId,
        ":uid": userId,
        ":ts": createdAt,
        ":mid": messageId,
        ":msk": messageSK,
        ":g2pk": userPk(userId),
        ":g2sk": g2sk,
      },
    })
  );
}

export const handler: SQSHandler = async (event) => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error("Missing TABLE_NAME");

  for (const record of event.Records) {
    const msg = JSON.parse(record.body) as MessageCreatedEvent;
    if (!msg || msg.eventType !== "MESSAGE_CREATED") continue;

    const members = await listMemberUserIds(tableName, msg.conversationId);
    if (members.length === 0) continue;

    // Best-effort fan-out. SQS will retry the whole batch if we throw;
    // so we avoid failing on individual ConditionalCheckFailed cases.
    const results = await Promise.allSettled(
      members.map((userId) =>
        updateInboxRow({
          tableName,
          userId,
          conversationId: msg.conversationId,
          createdAt: msg.createdAt,
          messageId: msg.messageId,
          messageSK: msg.messageSK,
        })
      )
    );

    // If there are any non-conditional failures, surface one to trigger retry.
    const hardError = results.find((r) => {
      if (r.status !== "rejected") return false;
      const name = (r.reason as any)?.name;
      return name !== "ConditionalCheckFailedException";
    }) as PromiseRejectedResult | undefined;
    if (hardError) throw hardError.reason;
  }
};

