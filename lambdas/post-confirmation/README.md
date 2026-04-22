# Post Confirmation Lambda (RushCord)

Chạy sau khi user xác nhận OTP (`ConfirmSignUp`). Ghi DynamoDB single-table RushCord: item `USER#<sub>` + `EMAIL#<email>` ref, `userId = sub`, không có `passwordHash`.

## Biến môi trường

- `TABLE_NAME` — cùng giá trị với `DYNAMODB_TABLE_NAME` của API RushCord.

## Triển khai (tóm tắt)

1. Trong thư mục này: `npm install`.
2. Tạo **Cognito User Pool** riêng RushCord (email alias, auto-verify email, SES nếu cần).
3. Tạo **Lambda** (Node 20+), entry `handler.handler`, upload zip hoặc dùng `aws lambda update-function-code`.
4. User Pool → Triggers → **Post confirmation** → chọn Lambda; cấp quyền IAM `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:TransactWriteItems` trên bảng RushCord.

App client pool: bật `USER_PASSWORD_AUTH` và refresh token.
