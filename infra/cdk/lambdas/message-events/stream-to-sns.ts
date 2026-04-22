import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";

const sns = new SNSClient({});

function isInsertMessage(rec: DynamoDBRecord): boolean {
  if (rec.eventName !== "INSERT") return false;
  const img = rec.dynamodb?.NewImage;
  if (!img) return false;
  const entityType = img.entityType?.S;
  return entityType === "Message";
}

export async function handler(event: DynamoDBStreamEvent) {
  const topicArn = process.env.TOPIC_ARN;
  if (!topicArn) throw new Error("Missing TOPIC_ARN");

  const publish = (event.Records || [])
    .filter(isInsertMessage)
    .map(async (rec) => {
      const img = rec.dynamodb!.NewImage!;
      const item = unmarshall(img) as any;

      const payload = {
        eventType: "MESSAGE_CREATED",
        conversationId: String(item.conversationId || ""),
        messageId: String(item.messageId || ""),
        createdAt: String(item.createdAt || ""),
        messageSK: String(item.SK || ""),
        senderId: String(item.senderId || ""),
      };

      // Avoid publishing malformed events
      if (!payload.conversationId || !payload.messageId || !payload.createdAt || !payload.messageSK) {
        return;
      }

      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify(payload),
          MessageAttributes: {
            eventType: { DataType: "String", StringValue: payload.eventType },
          },
        })
      );
    });

  await Promise.allSettled(publish);
  return { ok: true, published: publish.length };
}

