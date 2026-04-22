import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as s3 from "aws-cdk-lib/aws-s3";
import {
  NodejsFunction,
  OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { Construct } from "constructs";

export interface RushCordInfraStackProps extends cdk.StackProps {
  sesEmail?: {
    fromEmail: string;
    fromName?: string;
    sesRegion?: string;
    sesVerifiedDomain?: string;
  };
  /** When true, DynamoDB table and Cognito pool use RETAIN on stack delete (production). */
  retainTableAndPool?: boolean;
  /**
   * Browser origins allowed for S3 CORS (presigned PUT from the web app).
   * Defaults to http://localhost:5173 if omitted.
   */
  mediaCorsOrigins?: string[];
}

/**
 * Cognito + DynamoDB single-table (GSI1/GSI2) + Post Confirmation Lambda + public-read S3 media bucket.
 * Aligns with scripts/create-dynamodb-table.js and lambdas/post-confirmation/handler.mjs.
 */
export class RushCordInfraStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly mainTable: dynamodb.Table;
  public readonly mediaBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: RushCordInfraStackProps) {
    super(scope, id, props);

    const removalPolicy = props?.retainTableAndPool
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const emailFromSes = props?.sesEmail
      ? cognito.UserPoolEmail.withSES({
          fromEmail: props.sesEmail.fromEmail,
          fromName: props.sesEmail.fromName ?? "RushCord",
          ...(props.sesEmail.sesRegion
            ? { sesRegion: props.sesEmail.sesRegion }
            : {}),
          ...(props.sesEmail.sesVerifiedDomain
            ? { sesVerifiedDomain: props.sesEmail.sesVerifiedDomain }
            : {}),
        })
      : undefined;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "rushcord-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      ...(emailFromSes ? { email: emailFromSes } : {}),
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    this.userPoolClient = this.userPool.addClient("WebPublicClient", {
      userPoolClientName: "rushcord-web-public",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    this.mainTable = new dynamodb.Table(this, "MainTable", {
      tableName: `rushcord-main-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy,
    });

    this.mainTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.mainTable.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /**
     * Message events pipeline:
     * DynamoDB Streams (Message INSERT) -> Lambda -> SNS -> SQS (+DLQ) -> Lambda sync UserConversation.
     *
     * This provides async fan-out for inbox updates, especially useful for GROUP conversations.
     */
    const messageEventsTopic = new sns.Topic(this, "MessageEventsTopic", {
      topicName: `${this.stackName}-message-events`,
    });

    const inboxSyncDlq = new sqs.Queue(this, "InboxSyncDLQ", {
      queueName: `${this.stackName}-inbox-sync-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const inboxSyncQueue = new sqs.Queue(this, "InboxSyncQueue", {
      queueName: `${this.stackName}-inbox-sync`,
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: inboxSyncDlq,
        maxReceiveCount: 5,
      },
    });

    messageEventsTopic.addSubscription(
      new subs.SqsSubscription(inboxSyncQueue, {
        rawMessageDelivery: true,
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ["MESSAGE_CREATED"],
          }),
        },
      })
    );

    const messageEventsLambdaRoot = path.join(
      __dirname,
      "..",
      "lambdas",
      "message-events"
    );

    const streamToSnsFn = new NodejsFunction(this, "MessageStreamToSnsFn", {
      entry: path.join(messageEventsLambdaRoot, "stream-to-sns.ts"),
      handler: "handler",
      functionName: `${this.stackName}-MessageStreamToSns`,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TOPIC_ARN: messageEventsTopic.topicArn,
      },
      bundling: {
        format: OutputFormat.ESM,
        bundleAwsSDK: true,
        minify: true,
        sourceMap: false,
        target: "node20",
        mainFields: ["module", "main"],
      },
    });

    streamToSnsFn.addEventSource(
      new DynamoEventSource(this.mainTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        retryAttempts: 2,
      })
    );
    messageEventsTopic.grantPublish(streamToSnsFn);

    const syncUserConversationsFn = new NodejsFunction(
      this,
      "SyncUserConversationsFn",
      {
        entry: path.join(messageEventsLambdaRoot, "sync-user-conversations.ts"),
        handler: "handler",
        functionName: `${this.stackName}-SyncUserConversations`,
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          TABLE_NAME: this.mainTable.tableName,
        },
        bundling: {
          format: OutputFormat.ESM,
          bundleAwsSDK: true,
          minify: true,
          sourceMap: false,
          target: "node20",
          mainFields: ["module", "main"],
        },
      }
    );
    syncUserConversationsFn.addEventSource(
      new SqsEventSource(inboxSyncQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(2),
      })
    );
    this.mainTable.grantReadWriteData(syncUserConversationsFn);

    const postConfirmationRoot = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "lambdas",
      "post-confirmation"
    );

    const postConfirmationFn = new NodejsFunction(this, "PostConfirmationFn", {
      entry: path.join(postConfirmationRoot, "handler.mjs"),
      handler: "handler",
      functionName: `${this.stackName}-PostConfirmation`,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.mainTable.tableName,
      },
      bundling: {
        format: OutputFormat.ESM,
        bundleAwsSDK: true,
        minify: true,
        sourceMap: false,
        target: "node20",
        mainFields: ["module", "main"],
      },
      projectRoot: postConfirmationRoot,
      depsLockFilePath: path.join(
        postConfirmationRoot,
        "package-lock.json"
      ),
    });

    this.mainTable.grantReadWriteData(postConfirmationFn);
    postConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:TransactWriteItems"],
        resources: [this.mainTable.tableArn],
      })
    );
    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      postConfirmationFn
    );

    const corsOrigins =
      props?.mediaCorsOrigins !== undefined &&
      props.mediaCorsOrigins.length > 0
        ? props.mediaCorsOrigins
        : ["http://localhost:5173"];

    const mediaRemovalPolicy = props?.retainTableAndPool
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    this.mediaBucket = new s3.Bucket(this, "MediaBucket", {
      bucketName: `rushcord-media-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: mediaRemovalPolicy,
      autoDeleteObjects: !props?.retainTableAndPool,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: corsOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    this.mediaBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "PublicReadGetObject",
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject"],
        resources: [this.mediaBucket.arnForObjects("*")],
      })
    );

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Set COGNITO_USER_POOL_ID",
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.userPool.userPoolArn,
      description: "Cognito User Pool ARN",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Set COGNITO_CLIENT_ID",
    });

    new cdk.CfnOutput(this, "DynamoTableName", {
      value: this.mainTable.tableName,
      description: "Set DYNAMODB_TABLE_NAME",
    });

    new cdk.CfnOutput(this, "DynamoTableArn", {
      value: this.mainTable.tableArn,
      description: "DynamoDB table ARN",
    });

    new cdk.CfnOutput(this, "PostConfirmationFnArn", {
      value: postConfirmationFn.functionArn,
      description: "Post Confirmation Lambda ARN",
    });

    new cdk.CfnOutput(this, "MediaBucketName", {
      value: this.mediaBucket.bucketName,
      description: "Set S3_BUCKET_NAME for RushCord API (presigned upload)",
    });

    new cdk.CfnOutput(this, "MediaBucketArn", {
      value: this.mediaBucket.bucketArn,
      description: "S3 media bucket ARN — grant s3:PutObject to API IAM principal",
    });

    new cdk.CfnOutput(this, "MediaPublicBaseUrl", {
      value: `https://${this.mediaBucket.bucketName}.s3.${cdk.Aws.REGION}.amazonaws.com`,
      description: "Virtual-hosted-style base URL for public objects",
    });

    new cdk.CfnOutput(this, "MessageEventsTopicArn", {
      value: messageEventsTopic.topicArn,
      description: "SNS topic for message events (MESSAGE_CREATED, ...)",
    });

    new cdk.CfnOutput(this, "InboxSyncQueueUrl", {
      value: inboxSyncQueue.queueUrl,
      description: "SQS queue URL for inbox sync consumer",
    });
  }
}
