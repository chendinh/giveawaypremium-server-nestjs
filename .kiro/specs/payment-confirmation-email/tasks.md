# Implementation Plan: Payment Confirmation Email

## Overview

Bổ sung tính năng gửi email xác nhận chuyển khoản từ màn hình quản lý ký gửi. Gồm 5 thay đổi nhỏ, cô lập trên 5 file: thêm Cloud function backend, đăng ký function vào Parse, cập nhật template EJS, thêm method vào GapService, và thêm nút trong TableConsignmentScreen.

## Tasks

- [x] 1. Thêm `sendPaymentConfirmationEmail` vào `src/cloud/function/mail.ts`
  - [x] 1.1 Định nghĩa interface `PaymentEmailData`
    - Thêm interface ngay sau `ConsignmentEmailData` trong file `src/cloud/function/mail.ts`
    - Các field: `customerName`, `phoneNumber`, `identityId`, `consignmentId`, `numberOfProduct`, `bankName`, `bankId`, `moneyBack` (string đã format), `note` (string, fallback `"---"`)
    - _Requirements: 1.4_

  - [x] 1.2 Implement function `sendPaymentConfirmationEmail`
    - Query `Consignment` bằng `equalTo('objectId', consignmentId).include('consigner').first({ useMasterKey: true })`
    - Nếu `consignment` null → throw `Parse.Error.OBJECT_NOT_FOUND` với message mô tả rõ ID
    - Nếu `consigner` null hoặc không có `email`/`mail` → log error, return `{ success: true }` (fire-and-forget)
    - Build `PaymentEmailData`: `moneyBack` format `rawMoneyBack.toLocaleString('vi-VN') + ' vnd'` (fallback `'0 vnd'`), `note` fallback `'---'`
    - Render `EMAIL_PATHS[EMAIL_TYPES.PAYMENT]` qua `ejs.renderFile` rồi gọi `emailFactory.send()` với title `'Xác nhận chuyển khoản'`
    - Bọc render+send trong try/catch — log error, không re-throw (fire-and-forget SMTP)
    - Dùng `emailFactory` singleton đã có trong file, không tạo instance mới
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_

- [x] 2. Đăng ký Cloud function vào `src/cloud/main.ts`
  - [x] 2.1 Import và đăng ký `sendPaymentConfirmationEmail`
    - Thêm `sendPaymentConfirmationEmail` vào destructured import từ `'./function/mail'` (cùng dòng với `sendConsignmentEmail`)
    - Thêm `Parse.Cloud.define<(param: { consignmentId: string }) => { success: boolean }>('sendPaymentConfirmationEmail', sendPaymentConfirmationEmail, { ... })` ngay sau block `sendConsignmentEmail`
    - Validator: `requireUser: true`, field `consignmentId` type `String`, `required: true`, `options: (val: string) => !!val`, `error: 'consignmentId là bắt buộc và không được rỗng'`
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Cập nhật template `src/templates/email/payment.ejs`
  - [x] 3.1 Thêm dòng hiển thị `note` vào phần body
    - Thêm `<p><%= 'Ghi chú: ' + note; %></p>` ngay sau dòng `moneyBack` trong `<div class="content">`
    - Không thay đổi CSS, footer, hay bất kỳ phần nào khác của template
    - _Requirements: 5.2, 5.3, 5.4_

- [x] 4. Thêm `sendPaymentConfirmationEmail` vào `src/app/actions/GapServices.ts` (frontend)
  - [x] 4.1 Thêm static method vào class `GapService`
    - Thêm method ngay sau `sendEmailTongketWithObjectId`
    - Signature: `static async sendPaymentConfirmationEmail(consignmentObjectId: string): Promise<any>`
    - Body: `const body = { consignmentId: consignmentObjectId }; return this.fetchData('/functions/sendPaymentConfirmationEmail', REQUEST_TYPE.POST, null, body, null, null, null, true);`
    - Flag `useAuth: true` (tham số cuối `true`) để truyền `X-Parse-Session-Token`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Thêm nút "Gửi email đã trả tiền" vào `TableConsignmentScreen`
  - [x] 5.1 Thêm handler `handleSendPaymentEmail`
    - Thêm sau handler `handleSendEmail` hiện có
    - Signature: `const handleSendPaymentEmail = async (item: ConsignmentItem) => { ... }`
    - Gọi `await GapService.sendPaymentConfirmationEmail(item.objectId)`
    - `toast.success('Đã gửi email xác nhận thanh toán')` khi thành công
    - `toast.error('Có lỗi khi gửi email')` khi có lỗi (catch block)
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 5.2 Thêm `DropdownMenuItem` vào `DropdownMenuContent`
    - Thêm ngay sau item "Gửi email tổng kết" (`handleSendEmail`) trong cột Thao tác
    - `DollarSign` đã được import sẵn từ `lucide-react` — không cần thêm import
    - Nội dung: `<DropdownMenuItem onClick={() => handleSendPaymentEmail(item)} className="text-green-600"><DollarSign className="h-4 w-4 mr-2" />Gửi email đã trả tiền</DropdownMenuItem>`
    - _Requirements: 4.1, 4.5_

- [x] 6. Checkpoint — Đảm bảo toàn bộ thay đổi nhất quán
  - Chạy `npx tsc --noEmit` trên cả server và client
  - Kiểm tra runtime: gọi Cloud function qua Parse Dashboard hoặc curl để xác nhận function đã được đăng ký
  - Hỏi user nếu có câu hỏi phát sinh

## Notes

- Tasks `5.1` và `5.2` nằm trong cùng file — thực hiện tuần tự trong một lần sửa
- Template `payment.ejs` chỉ thêm đúng 1 dòng — không thay đổi style hay cấu trúc HTML
- `emailFactory` singleton dùng `MAIL_TYPE.SENDINBLUE` đã khởi tạo sẵn ở đầu `mail.ts` — không tạo thêm
- `EMAIL_TYPES.PAYMENT` và `EMAIL_PATHS` đã có sẵn trong `src/constants/email.ts`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2"] }
  ]
}
```
