# Requirements Document

## Introduction

Tính năng thêm nút gửi email xác nhận thanh toán ("Đã trả tiền") từ màn hình quản lý ký gửi dành cho admin. Khi admin bấm nút, hệ thống sẽ gửi email đến địa chỉ email của khách hàng (consigner) với nội dung xác nhận rằng Give Away Premium Quận 1 đã thực hiện chuyển khoản tiền tất toán cho đơn ký gửi đó.

Template email `payment.ejs` đã tồn tại trên server với đầy đủ nội dung. Cloud function `sendConsignmentEmail` (gửi biên nhận ký gửi) đã được xây dựng sẵn và là mẫu tham chiếu cho feature này. Tính năng mới sẽ bổ sung Cloud function `sendPaymentConfirmationEmail` tương tự, nhưng dùng template `payment.ejs` và bổ sung trường `moneyBack` (số tiền chuyển khoản) và `note` (ghi chú).

---

## Glossary

- **Payment_Confirmation_Email_Function**: Cloud function Parse `sendPaymentConfirmationEmail` — xử lý gửi email xác nhận chuyển khoản ở phía backend.
- **Email_Service**: `NodemailerFactory` tại `src/external-services/email/nodemailer.ts` — thực thi việc gửi email qua SMTP/Sendinblue.
- **Consignment**: Parse Class lưu thông tin đơn ký gửi, có pointer `consigner` (User), field `productList[]`, `bankName`, `bankId`, `moneyBack`, `note`.
- **Consigner**: Parse User — khách hàng ký gửi hàng. Có các field `name`, `phone`, `identityId` (CMND), `email`/`mail`.
- **Admin**: Người dùng đã đăng nhập với quyền quản trị, thao tác trên màn hình quản lý ký gửi.
- **TableConsignmentScreen**: Component frontend tại `src/app/admin/components/ManageScreen/components/TableConsignemntScreen/index.tsx` — hiển thị danh sách đơn ký gửi.
- **GapService**: Service layer frontend tại `src/app/actions/GapServices.ts` — tập trung tất cả API calls.
- **Payment_Email_Template**: File EJS tại `src/templates/email/payment.ejs` — template HTML email xác nhận chuyển khoản đã tồn tại.
- **moneyBack**: Số tiền chuyển khoản (đơn vị: nghìn đồng, dạng số) lưu trên đối tượng `Consignment`.
- **EMAIL_TYPES**: Enum tại `src/constants/email.ts` — liệt kê các loại email template hợp lệ.

---

## Requirements

### Requirement 1: Cloud Function gửi email xác nhận chuyển khoản

**User Story:** Là một admin, tôi muốn có một Cloud function backend để gửi email xác nhận chuyển khoản cho khách hàng, để hệ thống có thể gửi đúng nội dung và đúng người nhận.

#### Acceptance Criteria

1. WHEN `sendPaymentConfirmationEmail` được gọi với `consignmentId` hợp lệ, THE `Payment_Confirmation_Email_Function` SHALL truy vấn `Consignment` kèm `include('consigner')` bằng `useMasterKey: true`.
2. WHEN `Consignment` không tồn tại với `consignmentId` đã cho, THE `Payment_Confirmation_Email_Function` SHALL trả về lỗi `Parse.Error.OBJECT_NOT_FOUND` với message mô tả rõ ID không hợp lệ.
3. WHEN `consigner` của `Consignment` không có field `email` lẫn `mail`, THE `Payment_Confirmation_Email_Function` SHALL ghi log lỗi và kết thúc mà không throw exception (fire-and-forget pattern), trả về `{ success: true }` cho caller.
4. WHEN `consigner` có email hợp lệ, THE `Payment_Confirmation_Email_Function` SHALL render template `payment.ejs` với dữ liệu: `customerName`, `phoneNumber`, `identityId`, `consignmentId`, `numberOfProduct`, `bankName`, `bankId`, `moneyBack` (đã format số có dấu phẩy + " vnd"), `note`.
5. WHEN email được render thành công, THE `Email_Service` SHALL gửi email đến địa chỉ của `consigner` với tiêu đề `"Xác nhận chuyển khoản"`.
6. THE `Payment_Confirmation_Email_Function` SHALL yêu cầu người dùng đã đăng nhập (`requireUser: true`) khi đăng ký vào Parse Cloud.
7. THE `Payment_Confirmation_Email_Function` SHALL nhận đúng một tham số `consignmentId` kiểu `String`, là bắt buộc và không được rỗng.
8. IF `Email_Service` ném exception khi gửi, THEN THE `Payment_Confirmation_Email_Function` SHALL ghi log lỗi chi tiết và không re-throw exception (không làm crash caller).

---

### Requirement 2: Đăng ký Cloud Function vào Parse

**User Story:** Là một developer, tôi muốn Cloud function mới được đăng ký đúng cách trong hệ thống, để nó có thể được gọi qua REST API.

#### Acceptance Criteria

1. THE `Payment_Confirmation_Email_Function` SHALL được đăng ký trong `src/cloud/main.ts` bằng `Parse.Cloud.define('sendPaymentConfirmationEmail', ...)`.
2. WHEN `sendPaymentConfirmationEmail` được đăng ký, THE `Payment_Confirmation_Email_Function` SHALL có validator xác nhận `consignmentId` là `String`, bắt buộc (`required: true`), và không được rỗng.
3. THE `Payment_Confirmation_Email_Function` SHALL được đăng ký với option `requireUser: true` để chặn gọi không xác thực.

---

### Requirement 3: GapService method gửi email xác nhận thanh toán

**User Story:** Là một developer frontend, tôi muốn có một method trong `GapService` để gọi Cloud function gửi email xác nhận thanh toán, để component có thể gọi qua một API thống nhất.

#### Acceptance Criteria

1. THE `GapService` SHALL có static method `sendPaymentConfirmationEmail(consignmentObjectId: string)` trả về `Promise<any>`.
2. WHEN `sendPaymentConfirmationEmail` được gọi, THE `GapService` SHALL gửi `POST /functions/sendPaymentConfirmationEmail` với body `{ consignmentId: consignmentObjectId }` kèm session token (`requireUser: true` ở server).
3. THE `GapService.sendPaymentConfirmationEmail` SHALL dùng `fetchData` với flag `useAuth: true` (tham số cuối) để truyền `X-Parse-Session-Token` trong header.

---

### Requirement 4: Nút "Gửi email đã trả tiền" trong TableConsignmentScreen

**User Story:** Là một admin, tôi muốn có nút để gửi email xác nhận chuyển khoản ngay trên dòng của từng đơn ký gửi trong bảng quản lý, để có thể thông báo cho khách hàng sau khi thực hiện chuyển khoản.

#### Acceptance Criteria

1. THE `TableConsignmentScreen` SHALL hiển thị một action item "Gửi email đã trả tiền" trong `DropdownMenu` của cột "Thao tác" cho mỗi dòng đơn ký gửi.
2. WHEN admin bấm "Gửi email đã trả tiền", THE `TableConsignmentScreen` SHALL gọi `GapService.sendPaymentConfirmationEmail(item.objectId)`.
3. WHEN `GapService.sendPaymentConfirmationEmail` thành công, THE `TableConsignmentScreen` SHALL hiển thị toast success với nội dung "Đã gửi email xác nhận thanh toán".
4. IF `GapService.sendPaymentConfirmationEmail` throw lỗi, THEN THE `TableConsignmentScreen` SHALL hiển thị toast error với nội dung "Có lỗi khi gửi email".
5. WHILE yêu cầu gửi email đang chờ phản hồi, THE `TableConsignmentScreen` SHALL không disable toàn bộ UI — chỉ nút đó có thể hiển thị trạng thái loading nếu cần.

---

### Requirement 5: Nội dung và format email xác nhận chuyển khoản

**User Story:** Là một khách hàng nhận email, tôi muốn email có đầy đủ thông tin về giao dịch chuyển khoản, để tôi có thể đối chiếu và lưu trữ.

#### Acceptance Criteria

1. THE `Payment_Email_Template` SHALL hiển thị tiêu đề "Xác nhận chuyển khoản".
2. THE `Payment_Email_Template` SHALL hiển thị đầy đủ các trường: Họ tên khách hàng, Số điện thoại, CMND, Mã ký gửi, Số lượng, Ngân hàng đăng ký, ID Ngân hàng, Số tiền chuyển khoản, Ghi chú.
3. WHERE trường `note` có giá trị không rỗng, THE `Payment_Email_Template` SHALL hiển thị nội dung ghi chú trong phần thân email.
4. IF trường `note` rỗng hoặc không có giá trị, THEN THE `Payment_Email_Template` SHALL hiển thị "---" thay cho nội dung ghi chú.
5. THE `Payment_Email_Template` SHALL hiển thị phần footer với nội dung: liên hệ Zalo 0703334443, lời cảm ơn, và chữ ký "Give Away Premium".
6. THE `Payment_Email_Template` SHALL có style nhất quán với template `consignment.ejs` hiện có (cùng font, màu sắc, logo, layout).
