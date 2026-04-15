#!/usr/bin/env node
import * as path from "path";
import { config as loadEnv } from "dotenv";
import * as cdk from "aws-cdk-lib";
import { RushCordInfraStack } from "../lib/rushcord-infra-stack";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });

const app = new cdk.App();

const region =
  process.env.CDK_DEFAULT_REGION ??
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  "ap-southeast-1";

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;

function pick(
  contextKey: string,
  envValue: string | undefined
): string | undefined {
  const fromCtx = app.node.tryGetContext(contextKey) as string | undefined;
  if (fromCtx !== undefined && fromCtx !== "") {
    return fromCtx;
  }
  if (envValue !== undefined && envValue !== "") {
    return envValue;
  }
  return undefined;
}

const sesFromEmail = pick("sesFromEmail", process.env.SES_FROM_EMAIL);
const sesFromName = pick("sesFromName", process.env.SES_FROM_NAME);
const sesRegion = pick("sesRegion", process.env.SES_REGION);
const sesVerifiedDomain = pick(
  "sesVerifiedDomain",
  process.env.SES_VERIFIED_DOMAIN
);

const retainCtx = app.node.tryGetContext("retainData");
const retainData =
  retainCtx === true ||
  String(retainCtx).toLowerCase() === "true" ||
  process.env.CDK_RETAIN_DATA === "1";

const mediaCorsCtx = app.node.tryGetContext("mediaCorsOrigins") as
  | string
  | undefined;
const mediaCorsFromEnv = process.env.MEDIA_CORS_ORIGINS;
const mediaCorsRaw = mediaCorsCtx ?? mediaCorsFromEnv;
const mediaCorsOrigins = mediaCorsRaw
  ? mediaCorsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  : undefined;

new RushCordInfraStack(app, "RushCordInfraStack", {
  description:
    "RushCord — Cognito, DynamoDB (GSI1/GSI2), Post Confirmation Lambda, S3 media",
  env: account
    ? {
        account,
        region,
      }
    : { region },
  tags: {
    Project: "rushcord",
    ManagedBy: "cdk",
  },
  sesEmail:
    sesFromEmail !== undefined && sesFromEmail !== ""
      ? {
          fromEmail: sesFromEmail,
          fromName: sesFromName,
          sesRegion,
          sesVerifiedDomain,
        }
      : undefined,
  retainTableAndPool: retainData,
  mediaCorsOrigins,
});
