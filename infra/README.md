# Hạ tầng AWS — CDK (RushCord)

Thư mục [`cdk/`](cdk/) chứa ứng dụng **AWS CDK** (TypeScript). `cdk synth` sinh template CloudFormation; `cdk deploy` tạo hoặc cập nhật stack **RushCordInfraStack**.

## Điều kiện

- Node.js 18+
- AWS CLI đã cấu hình (`aws sts get-caller-identity`)
- Quyền IAM đủ để deploy (thường dùng policy AdministratorAccess khi học / dev)

## Cài đặt

```bash
cd infra/cdk
npm install
```

Trước `synth` / `deploy`, cài dependency cho Lambda post-confirmation (để có `package-lock.json` ổn định cho bundling):

```bash
cd lambdas/post-confirmation
npm install
```

## SES (tuỳ chọn — email xác nhận Cognito)

Giống luồng be-ott: verify identity trong **Amazon SES** (cùng region với stack). Thêm vào `.env` ở **thư mục gốc** `RushCord-Backend-main` (không commit):

```env
SES_FROM_EMAIL=you@verified.example.com
SES_FROM_NAME=RushCord
# SES_VERIFIED_DOMAIN=example.com   # nếu verify domain
# SES_REGION=ap-southeast-1         # nếu SES khác region User Pool
```

Nếu không set `SES_FROM_EMAIL`, Cognito dùng email mặc định (quota thấp, chỉ phù hợp thử nhanh).

## Bootstrap (một lần / account / region)

```bash
cd infra/cdk
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

Hoặc từ thư mục gốc backend:

```bash
npm run cdk:bootstrap
```

## Synth & deploy

```bash
cd infra/cdk
npm run synth
npm run deploy
```

Từ thư mục gốc `RushCord-Backend-main`:

```bash
npm run cdk:synth
npm run cdk:deploy
```

Ghi đè SES bằng context (ưu tiên hơn `.env`):

```bash
cd infra/cdk
npx cdk deploy -c sesFromEmail=other@verified.com
```

Giữ User Pool và bảng DynamoDB khi xóa stack (DeletionPolicy RETAIN): `CDK_RETAIN_DATA=1` hoặc `npx cdk deploy -c retainData=true`.

## Outputs → `.env` API

Sau `deploy`, mở CloudFormation Outputs hoặc log CLI và cập nhật `.env` của backend:

| Output              | Biến `.env`              |
|---------------------|---------------------------|
| `UserPoolId`        | `COGNITO_USER_POOL_ID`    |
| `UserPoolClientId`  | `COGNITO_CLIENT_ID`       |
| `DynamoTableName`   | `DYNAMODB_TABLE_NAME`     |

Đặt `AWS_REGION` trùng region deploy.

## Tài nguyên trong stack

- **Cognito**: User Pool `rushcord-users`, app client `rushcord-web-public` (SRP + USER_PASSWORD).
- **DynamoDB**: bảng `rushcord-main-<AccountId>-<Region>`, khóa `PK` / `SK`, GSI **GSI1** và **GSI2** (khớp [`scripts/create-dynamodb-table.js`](../scripts/create-dynamodb-table.js)).
- **Lambda**: Post Confirmation — bundle từ [`lambdas/post-confirmation/handler.mjs`](../lambdas/post-confirmation/handler.mjs).

## Media (S3)

Stack tạo thêm **S3 media bucket** `rushcord-media-<AccountId>-<Region>` dùng cho:

- Upload: **presigned PUT** (trình duyệt upload trực tiếp lên S3).
- Download/hiển thị: object **public-read qua bucket policy** (URL ổn định).

### Outputs → `.env` API

Ngoài Cognito/DynamoDB, sau `deploy` lấy thêm:

| Output            | Biến `.env`         |
|------------------|----------------------|
| `MediaBucketName`| `S3_BUCKET_NAME`     |

### IAM tối thiểu cho API (media)

IAM principal chạy API cần quyền trên bucket media:

- `s3:PutObject` trên `arn:aws:s3:::<MediaBucketName>/*` (để tạo presigned PUT và cho phép upload thực tế).
- `s3:DeleteObject` trên `arn:aws:s3:::<MediaBucketName>/*` (để **thu hồi ALL** xóa luôn file trên S3, best-effort).

## IAM gợi ý cho API (khi chạy trên ECS/EC2)

Ở máy dev, API dùng credential chain (AWS CLI / biến môi trường). Khi deploy API lên AWS, gắn role với quyền tối thiểu, ví dụ:

- `cognito-idp:*` trên User Pool ARN (thu hẹp theo API thực tế: SignUp, InitiateAuth, …).
- DynamoDB: `GetItem`, `Query`, `PutItem`, `UpdateItem`, `DeleteItem`, `TransactWriteItems`, `BatchWriteItem` trên bảng và `…/index/*` nếu query GSI.

## Xóa stack

```bash
cd infra/cdk
npx cdk destroy
```

Với `RemovalPolicy` mặc định (dev), một số tài nguyên bị xóa theo template; khi bật retain, User Pool / bảng có thể giữ lại — kiểm tra trước khi `destroy`.
