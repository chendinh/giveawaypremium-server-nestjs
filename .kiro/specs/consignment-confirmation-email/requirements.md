# Requirements Document

## Introduction

Tính năng này tự động gửi email xác nhận biên nhận ký gửi (consignment confirmation email) cho khách hàng ký gửi (consigner) ngay sau khi đơn ký gửi mới được tạo thành công trên hệ thống GiveAwayPremium.

Hiện tại, khi tạo `Consignment` mới, `afterSave` trigger chỉ tạo các bản ghi `Product`. Email infrastructure (`MailFactory` + Sendinblue) và template EJS (`consignment.ejs`) đã có sẵn, nhưng Cloud Function `sendConsignmentEmail` chưa được implement.

Mục tiêu: implement Cloud Function `sendConsignmentEmail` và tích hợp nó vào `afterSave` trigger của `Consignment`, đảm bảo consigner nhận được email xác nhận đầy đủ thông tin ngay sau khi đơn ký gửi được tạo.

## Glossary

- **Consignment**: Đơn ký gửi — bản ghi lưu thông tin một lần ký gửi hàng hóa của khách hàng
- **Consigner**: Người ký gửi — khách hàng đưa hàng vào cửa hàng để ký gửi bán lại
- **Consignee**: Người nhận ký gửi — nhân viên/cửa hàng tiếp nhận hàng ký gửi
- **ConsignmentGroup**: Nhóm ký gửi — tập hợp nhiều đơn ký gửi trong cùng một đợt
- **ProductList**: Danh sách sản phẩm thô trong đơn ký gửi (raw array trên Consignment object)
- **MailFactory**: Singleton factory khởi tạo email service, hỗ trợ NODEMAILER và SENDINBLUE
- **Sendinblue**: Nhà cung cấp dịch vụ email transactional đang được sử dụng
- **sendConsignmentEmail**: Parse Cloud Function gửi email xác nhận ký gửi, được đề cập trong API contract nhưng chưa implement
- **afterSave trigger**: Parse Cloud trigger tự động chạy sau khi một object được lưu vào database
- **EJS Template**: Template engine dùng để render nội dung HTML email (`consignment.ejs`)
- **Parse.Cloud.define**: Hàm đăng ký một Cloud Function có thể gọi từ client

## Requirements

### Requirement 1: Gửi email xác nhận tự động khi tạo đơn ký gửi mới

**User Story:** Là một khách hàng ký gửi, tôi muốn nhận email xác nhận ngay sau khi đơn ký gửi được tạo thành công, để tôi có thể lưu lại thông tin biên nhận và theo dõi đơn hàng của mình.

#### Acceptance Criteria

1. WHEN một `Consignment` mới được tạo thành công, THE `ConsignmentEmailService` SHALL tự động gửi email xác nhận đến địa chỉ email của consigner.
2. WHEN gửi email xác nhận, THE `ConsignmentEmailService` SHALL render template `consignment.ejs` với dữ liệu đầy đủ bao gồm: `customerName`, `phoneNumber`, `identityId`, `consignmentId`, `numberOfProduct`, `bankName`, `bankId`, `timeGetMoney`, `timeCheck`, và mảng `products`.
3. WHEN consigner không có địa chỉ email trong hồ sơ, THE `ConsignmentEmailService` SHALL ghi log cảnh báo và bỏ qua việc gửi email mà không làm gián đoạn luồng tạo đơn ký gửi.
4. IF việc gửi email thất bại vì lỗi từ Sendinblue hoặc lỗi render template, THEN THE `ConsignmentEmailService` SHALL ghi log lỗi chi tiết và tiếp tục hoàn thành `afterSave` trigger mà không throw exception.

---

### Requirement 2: Cloud Function `sendConsignmentEmail` có thể gọi thủ công

**User Story:** Là một admin, tôi muốn có thể gọi thủ công Cloud Function `sendConsignmentEmail` để gửi lại email xác nhận cho một đơn ký gửi cụ thể khi cần, ví dụ khi email trước đó bị lỗi hoặc khách hàng yêu cầu gửi lại.

#### Acceptance Criteria

1. THE `Parse.Cloud` SHALL expose một Cloud Function tên `sendConsignmentEmail` nhận tham số `consignmentId` (string, required).
2. WHEN `sendConsignmentEmail` được gọi với `consignmentId` hợp lệ, THE `ConsignmentEmailService` SHALL fetch `Consignment` kèm theo `consigner` (include) và gửi email xác nhận.
3. WHEN `sendConsignmentEmail` được gọi với `consignmentId` không tồn tại, THE `ConsignmentEmailService` SHALL throw `Parse.Error` với code `OBJECT_NOT_FOUND` và message mô tả rõ.
4. THE `sendConsignmentEmail` Cloud Function SHALL yêu cầu người dùng đã đăng nhập (`requireUser: true`) để gọi được.

---

### Requirement 3: Dữ liệu email được lấy chính xác từ Consignment

**User Story:** Là một khách hàng ký gửi, tôi muốn email xác nhận hiển thị đầy đủ và chính xác thông tin cá nhân và danh sách sản phẩm ký gửi của mình, để tôi có thể kiểm tra và lưu làm biên nhận.

#### Acceptance Criteria

1. WHEN render email template, THE `ConsignmentEmailService` SHALL lấy `customerName` từ field `name` của consigner Parse.User object.
2. WHEN render email template, THE `ConsignmentEmailService` SHALL lấy `phoneNumber` từ field `phone` của consigner Parse.User object.
3. WHEN render email template, THE `ConsignmentEmailService` SHALL lấy `identityId` từ field `identityId` của consigner Parse.User object.
4. WHEN render email template, THE `ConsignmentEmailService` SHALL lấy `bankName` và `bankId` từ fields tương ứng trên Consignment object.
5. WHEN render email template, THE `ConsignmentEmailService` SHALL lấy `timeGetMoney` và tính `timeCheck` bằng cách trừ 3 ngày từ `timeGetMoney` theo format `DD-MM-YYYY`.
6. WHEN render email template, THE `ConsignmentEmailService` SHALL map `productList` trên Consignment thành mảng `products` gồm các field: `name`, `amount` (từ `count`), `status` (từ `rateNew`), `price`, `priceAfterFee`.
7. IF một field tùy chọn (như `bankName`, `bankId`, `identityId`) không có giá trị, THEN THE `ConsignmentEmailService` SHALL thay thế bằng chuỗi rỗng `''` để tránh lỗi render template.

---

### Requirement 4: Tính toàn vẹn của luồng tạo Consignment

**User Story:** Là một admin, tôi muốn việc gửi email không ảnh hưởng đến luồng tạo đơn ký gửi chính, để đơn ký gửi luôn được tạo thành công dù email có lỗi hay không.

#### Acceptance Criteria

1. WHEN `afterSave` trigger của `Consignment` chạy với `context.isNew === true`, THE `ConsignmentAfterSave` SHALL thực thi việc tạo Product records và gửi email xác nhận song song (không block lẫn nhau).
2. IF quá trình gửi email xác nhận throw exception, THEN THE `ConsignmentAfterSave` SHALL bắt exception đó, ghi log lỗi, và không re-throw để đảm bảo `afterSave` hoàn thành thành công.
3. WHILE `afterSave` trigger đang chạy, THE `ConsignmentAfterSave` SHALL không làm trì hoãn response trả về client vì email được gửi bất đồng bộ (fire-and-forget với error handling).

---

### Requirement 5: Đăng ký Cloud Function trong hệ thống

**User Story:** Là một developer, tôi muốn `sendConsignmentEmail` được đăng ký đúng cách trong `cloud/main.ts` cùng với các Cloud Function khác, để hàm có thể được gọi từ client theo đúng API contract đã định nghĩa.

#### Acceptance Criteria

1. THE `cloud/main.ts` SHALL register `sendConsignmentEmail` bằng `Parse.Cloud.define` với validation schema cho tham số `consignmentId`.
2. WHEN đăng ký Cloud Function, THE `cloud/main.ts` SHALL import handler `sendConsignmentEmail` từ `cloud/function/mail.ts` (file hiện đang chứa các email functions khác như `remiderIndividualConsignment`).
3. THE `sendConsignmentEmail` function SHALL được validate tham số `consignmentId` là `String`, `required: true`, và không rỗng trước khi thực thi logic.
