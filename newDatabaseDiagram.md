# Thiết kế DynamoDB single-table — OTT Chat (`ott`)

Tài liệu mô tả các **thực thể**, **khóa (PK/SK)**, **GSI** và **ý nghĩa từng field** cho hệ thống chat (1 region, quy mô học tập).  
Mô hình message: **Option A** — `SK` của message kết hợp **thời gian + messageId** để sort và so sánh đọc/chưa đọc ổn định.

---

## 1. Bảng và khóa chính


| Thuộc tính             | Ý nghĩa                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Bảng `ott`**         | Một bảng chứa nhiều loại item (single-table): profile user, hội thoại, thành viên, inbox, tin nhắn.              |
| **PK** (partition key) | Xác định **nhóm dữ liệu** cùng partition; query hiệu quả khi biết PK.                                            |
| **SK** (sort key)      | Sắp xếp và phân trang trong một PK; prefix (`META`, `MEMBER#`, `MSG#`, `CONV#`, `PROFILE`…) phân biệt loại item. |


---

## 2. Global Secondary Index (GSI)

### GSI1 — tra cứu tin nhắn theo `messageId`


|               | Giá trị                                                |
| ------------- | ------------------------------------------------------ |
| **Tên gợi ý** | `GSI1`                                                 |
| **GSI1PK**    | `MSG#<messageId>`                                      |
| **GSI1SK**    | `CONV#<conversationId>#SK#MSG#<createdAt>#<messageId>` |


**Tác dụng**

- **Query theo `messageId`** khi không biết sẵn `PK/SK` đầy đủ (deep link, báo cáo, jump to message).
- **GSI1SK** lưu thêm `conversationId` + bản sao `messageSK` để sau khi tìm được item, biết ngữ cảnh phòng và thứ tự.

---

### GSI2 — inbox: danh sách hội thoại của một user, sort theo tin mới nhất


|               | Giá trị                                       |
| ------------- | --------------------------------------------- |
| **Tên gợi ý** | `GSI2`                                        |
| **GSI2PK**    | `USER#<userId>`                               |
| **GSI2SK**    | `INBOX#<lastMessageAt>#CONV#<conversationId>` |


**Tác dụng**

- **Một query** lấy **tất cả hội thoại** mà user tham gia, **sắp xếp theo `lastMessageAt`** (tin mới lên trên khi `ScanIndexForward=false`).
- Base table dùng `PK=USER#…`, `SK=CONV#…` để **Get/Update** một dòng inbox cụ thể; GSI2 dùng để **list + sort** theo thời gian mà không đổi SK trên base (tránh phải “đổi key” mỗi lần có tin mới).

**Lưu ý**

- `lastMessageAt` nên là **ISO-8601 UTC** (chuỗi sort được đúng thứ tự thời gian).
- Khi có tin mới, cần **cập nhật thuộc tính GSI2SK** trên item `UserConversation` (thường là `UpdateItem` đổi `lastMessageAt` → GSI2SK đổi theo).

---

## 3. Các thực thể (item types)

Dưới đây: **PK**, **SK**, field dự kiến, và **ý nghĩa**.

---

### 3.1. `ConversationMeta` — metadata chung của một hội thoại


|         |                                      |
| ------- | ------------------------------------ |
| **PK**  | `CONV#<conversationId>`              |
| **SK**  | `META`                               |
| **GSI** | Không (tra cứu trực tiếp bằng PK+SK) |



| Field            | Kiểu / gợi ý     | Ý nghĩa                                                                                                              |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `conversationId` | string           | Định danh phòng.                                                                                                     |
| `type`           | `DM`             | `GROUP`                                                                                                              |
| `title`          | string, optional | Tên nhóm (GROUP); DM có thể để trống, hiển thị lấy từ user kia.                                                      |
| `avatar`         | string, optional | Ảnh đại diện nhóm.                                                                                                   |
| `createdAt`      | ISO string       | Thời điểm tạo phòng.                                                                                                 |
| `createdBy`      | string (userId)  | Người tạo (nhóm).                                                                                                    |
| `lastMessageAt`  | ISO string       | Thời gian tin **mới nhất** trong phòng.                                                                              |
| `lastMessageId`  | string           | Id tin mới nhất.                                                                                                     |
| `lastMessageSK`  | string           | **SK đầy đủ** của tin mới nhất (`MSG#<createdAt>#<messageId>`), dùng so sánh với `lastReadSK`, mark-read “tới cuối”. |
| `memberCount`    | number           | Số thành viên (tiện hiển thị/quản trị).                                                                              |


**Tác dụng tổng thể**

- **Một `GetItem`** biết trạng thái phòng và **mốc tin cuối** mà không phải query toàn bộ messages.
- Không lưu `lastMessagePreview` ở meta (theo thiết kế hiện tại); preview inbox nằm ở `UserConversation`.

---

### 3.2. `ConversationMember` — thành viên trong một hội thoại


|         |                         |
| ------- | ----------------------- |
| **PK**  | `CONV#<conversationId>` |
| **SK**  | `MEMBER#<userId>`       |
| **GSI** | Không                   |



| Field            | Ý nghĩa                                                |
| ---------------- | ------------------------------------------------------ |
| `conversationId` | Phòng chứa member.                                     |
| `userId`         | User trong phòng.                                      |
| `fullName`       | **Snapshot** tên hiển thị (list member/mention nhanh). |
| `role`           | `OWNER`                                                |
| `joinedAt`       | Thời gian vào phòng.                                   |
| `status`         | PENDING | ACCEPTED                                     |


**Tác dụng**

- **Query** `PK = CONV#cid` và `SK begins_with MEMBER#` → **danh sách thành viên**.
- **GetItem** `PK=CONV#cid`, `SK=MEMBER#uid` → **kiểm tra user có trong phòng** (authorize gửi/đọc).

---

### 3.3. `UserConversation` — “dòng inbox” + cursor đọc của từng user trong từng phòng


|            |                                               |
| ---------- | --------------------------------------------- |
| **PK**     | `USER#<userId>`                               |
| **SK**     | `CONV#<conversationId>`                       |
| **GSI2PK** | `USER#<userId>`                               |
| **GSI2SK** | `INBOX#<lastMessageAt>#CONV#<conversationId>` |



| Field                | Ý nghĩa                       |
| -------------------- | ----------------------------- |
| `userId`             | Chủ sở hữu dòng inbox.        |
| `conversationId`     | Phòng tương ứng.              |
| `type`               | `DM`                          |
| `otherUserId`        | string, **chỉ khi `type=DM`** |
| `lastMessageAt`      | ISO                           |
| `lastMessageId`      | string                        |
| `lastMessageSK`      | string                        |
| `lastReadSK`         | string                        |


**Tác dụng**

- **GSI2**: lấy **toàn bộ hội thoại của user**, sort theo hoạt động gần nhất.
- **Base table**: cập nhật read/preview cho **đúng một cặp (user, conversation)**.

---

### 3.4. `Message` — một tin nhắn (một payload: text hoặc một media)


|            |                                                        |
| ---------- | ------------------------------------------------------ |
| **PK**     | `CONV#<conversationId>`                                |
| **SK**     | `MSG#<createdAt>#<messageId>`                          |
| **GSI1PK** | `MSG#<messageId>`                                      |
| **GSI1SK** | `CONV#<conversationId>#SK#MSG#<createdAt>#<messageId>` |



| Field            | Ý nghĩa                              |
| ---------------- | ------------------------------------ |
| `conversationId` | Phòng chứa tin.                      |
| `messageId`      | UUID — id ổn định, tra cứu qua GSI1. |
| `createdAt`      | ISO — thời điểm tạo; một phần của SK để sort. |
| `senderId`       | Người gửi; **chỉ** `senderId` mới được **thu hồi** hoặc **chỉnh sửa** (theo nghiệp vụ đã chốt). |
| `type`           | `TEXT` \| `IMAGE` \| `VIDEO` \| `FILE` \| `AUDIO` \| `SYSTEM` |
| `text`           | Nullable — nội dung text hoặc caption. |
| `isForwarded`    | Boolean — `true` thì UI render tin **chuyển tiếp** (chỉ cờ, không lưu thêm metadata forward). |
| `recallScope`    | `null` \| `"ALL"` \| `"ME"` — thu hồi **chỉ do người gửi**: `null` = chưa thu hồi; `"ALL"` = mọi người trong phòng thấy tin đã thu hồi; `"ME"` = **chỉ người gửi** thấy trạng thái thu hồi, **người khác** vẫn thấy nội dung bình thường. |
| `recalledAt`     | ISO, optional — nên ghi khi `recallScope` khác `null`. |
| `editHistory`    | `string[]` — **chỉ text**: các bản nội dung trước khi sửa; quy ước mỗi lần sửa **đẩy** `text` hiện tại vào cuối `editHistory` rồi gán `text` mới. Tin có media có thể để `[]` hoặc không dùng trường này. |



**Object `media`** (khi `type != TEXT`)


| Field         | Ý nghĩa                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `s3Key`       | Key object trên S3 — **chuẩn bị** chuyển sang private + pre-signed GET sau này. |
| `publicUrl`   | URL public hiện tại — FE render trực tiếp.                                      |
| `fileName`    | Tên file gốc.                                                                   |
| `contentType` | MIME — chọn component (img/video/audio), validate.                              |
| `sizeBytes`   | Dung lượng — hiển thị, giới hạn.                                                |


**Tác dụng**

- **Query** `PK=CONV#cid`, `SK begins_with MSG#` → timeline, phân trang theo SK.
- **Đọc/chưa đọc**: so sánh `SK` với `UserConversation.lastReadSK`.
- **Thu hồi**: API trả nội dung tùy `recallScope` và `viewerId` (với `"ME"`, chỉ khi `viewerId === senderId` thì coi là đã thu hồi). Không trả `text` / `media` khi tin đã thu hồi **đối với** viewer tương ứng.
- **Chỉnh sửa**: chỉ `senderId`; cập nhật `text` và `editHistory` như trên. Lịch sử nhúng trong item — chú ý giới hạn **400 KB** / item DynamoDB.

---

### 3.5. `User` — hồ sơ cơ bản


|         |                                         |
| ------- | --------------------------------------- |
| **PK**  | `USER#<userId>`                         |
| **SK**  | `PROFILE`                               |
| **GSI** | Không (tra cứu theo `userId` qua PK+SK) |



| Field                     | Ý nghĩa                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `userId`                  | Định danh (thường trùng Cognito `sub` hoặc id nội bộ).                                                               |
| `fullName`                | Tên hiển thị.                                                                                                        |
| `avatarUrl`               | Ảnh đại diện (URL).                                                                                                  |
| `userName`                | Tên đăng nhập / @username — **unique** theo nghiệp vụ (DynamoDB không có constraint native; kiểm tra trước khi ghi). |
| `createdAt` / `updatedAt` | Audit.                                                                                                               |


**Tác dụng**

- Nguồn **profile** cho DM (`otherUserId`), header, tra cứu user theo `userId`.

**Lưu ý cùng partition**

- Cùng `PK=USER#<userId>` có thể có nhiều item: `SK=PROFILE` và các `SK=CONV#…` (`UserConversation`) — hợp lệ trong single-table.

---

## 4. Quy tắc đọc / chưa đọc (tóm tắt)

- Mỗi `Message` có `SK = MSG#<createdAt>#<messageId>`.
- `UserConversation.lastReadSK` là **điểm dừng đọc** cùng định dạng.
- **Đã đọc** nếu `message.SK <= lastReadSK` (chuỗi so sánh đúng khi `createdAt` là ISO sortable và `messageId` ổn định).

---

## 5. Luồng dữ liệu tóm tắt (tham chiếu)


| Nhu cầu                   | Thực thể / index              |
| ------------------------- | ----------------------------- |
| Danh sách chat của user   | `UserConversation` + **GSI2** |
| Chi tiết một phòng (nhóm) | `ConversationMeta`            |
| Ai trong phòng            | `ConversationMember`          |
| Timeline tin nhắn         | `Message` (`PK=CONV#…`)       |
| Tìm tin theo id           | **GSI1**                      |
| Profile user              | `User` (`PROFILE`)            |


---

## 6. Các Access Pattern

### 1. Danh sách các hội thoại của User

| Thao tác | **Query** trên **GSI2** |
| -------- | ------------------------ |
| **GSI2PK** | `USER#<userId>` |
| **Điều kiện SK** | `GSI2SK` bắt đầu bằng `INBOX#` (hoặc không cần `begins_with` nếu mọi giá trị SK của inbox đều dùng prefix đó). |
| **Thứ tự** | `ScanIndexForward = false` — hội thoại có `lastMessageAt` **mới nhất** lên trước (khớp cách sort `INBOX#<lastMessageAt>#…`). |
| **Phân trang** | `Limit` + `ExclusiveStartKey` theo kết quả GSI2. |

**Ghi chú:** Mỗi dòng trả về là item **`UserConversation`** (inbox) của user đó; có thể kết hợp **`GetItem`** `PK=USER#…`, `SK=CONV#…` trên base nếu cần bản đầy đủ field không chiếu hết lên GSI.

---

### 2. Danh sách các thành viên trong nhóm

| Thao tác | **Query** trên **bảng chính** |
| -------- | ------------------------------ |
| **PK** | `CONV#<conversationId>` |
| **Điều kiện SK** | `SK begins_with MEMBER#` |
| **Lọc thêm (tùy chọn)** | `FilterExpression` theo `status` (ví dụ `ACCEPTED`) nếu nghiệp vụ cần — lưu ý RCU vẫn tính trên phạm vi query trước filter. |

**Ý nghĩa:** Mỗi item là **`ConversationMember`**; không cần GSI vì đã gom theo partition phòng.

---

### 3. 20 tin nhắn mới nhất của một hội thoại

| Thao tác | **Query** trên **bảng chính** |
| -------- | ------------------------------ |
| **PK** | `CONV#<conversationId>` |
| **Điều kiện SK** | `SK begins_with MSG#` |
| **Thứ tự** | `ScanIndexForward = false` — đọc từ **SK lớn nhất** (tin **mới nhất** trước), vì `MSG#<createdAt>#<messageId>` sort theo thời gian tăng dần khi `createdAt` là ISO sortable. |
| **Giới hạn** | `Limit = 20` (lấy đúng 20 bản ghi đầu trong hướng đọc đó). |
| **Tải thêm** | Phân trang **lùi về quá khứ**: dùng `ExclusiveStartKey` từ lần query trước, cùng `ScanIndexForward = false`, `Limit` tùy UI. |

**Ghi chú:** Chỉ trả về item **`Message`**; các item khác cùng PK (`META`, `MEMBER#…`) không khớp `begins_with MSG#` nên không lẫn vào kết quả.



---

*Tài liệu phản ánh thiết kế đã thống nhất: không `ConversationMeta.lastMessagePreview`; message một `media`, không thumbnail URL; `ConversationMember.fullName`; inbox có `otherUserId` cho DM; `Message` có `isForwarded`, `recallScope` (`ME` \| `ALL` \| `null`) + `recalledAt`, `editHistory` (chỉ text, nhúng trong item).*
