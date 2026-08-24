# Implementation Plan: Consignment Confirmation Email

## Overview

Implement tính năng gửi email xác nhận biên nhận ký gửi tự động và thủ công.
Thay đổi tập trung vào 3 file: `src/cloud/function/mail.ts`, `src/cloud/consignment/index.ts`, và `src/cloud/main.ts`.
Tests viết bằng Jest + fast-check (property-based) trong file `src/cloud/function/mail.spec.ts`.

## Tasks

- [x] 1. Thêm interfaces và hàm `buildEmailData` vào `mail.ts`
  - [x] 1.1 Khai báo interfaces `ConsignmentEmailData` và `ProductEmailItem`
    - Thêm interface `ConsignmentEmailData` với các fields: `customerName`, `phoneNumber`, `identityId`, `consignmentId`, `numberOfProduct`, `bankName`, `bankId`, `timeGetMoney`, `timeCheck`, `products`
    - Thêm interface `ProductEmailItem` với các fields: `name`, `amount`, `status`, `price`, `priceAfterFee`
    - Đặt trong `src/cloud/function/mail.ts`, trước các hàm hiện có
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_

  - [x] 1.2 Implement hàm pure function `buildEmailData`
    - Map `customerName` từ `consigner.get('name')`, fallback `''`
    - Map `phoneNumber` từ `consigner.get('phone')`, fallback `''`
    - Map `identityId` từ `consigner.get('identityId')`, fallback `''`
    - Map `consignmentId` từ `consignment.id`
    - Map `numberOfProduct` từ `productList.length`, fallback `0`
    - Map `bankName`, `bankId` từ consignment, fallback `''`
    - Map `timeGetMoney` từ consignment, fallback `''`
    - Tính `timeCheck` bằng `moment(timeGetMoney, 'DD-MM-YYYY').subtract(3, 'days').format('DD-MM-YYYY')`, fallback `''` khi `timeGetMoney` rỗng
    - Map `products` array từ `productList`: `amount` ← `count`, `status` ← `rateNew`, `price`, `priceAfterFee`, `name`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]\* 1.3 Viết property test — Property 1: buildEmailData maps đầy đủ all required fields
    - **Property 1: buildEmailData maps all required fields**
    - **Validates: Requirements 1.2, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7**
    - Dùng `fc.assert` với `arbitraryConsignment()` generator, `numRuns: 100`
    - Assert tất cả 10 fields không undefined
    - Tag: `Feature: consignment-confirmation-email, Property 1: buildEmailData maps all required fields`

  - [ ]\* 1.4 Viết property test — Property 2: timeCheck = timeGetMoney − 3 ngày
    - **Property 2: timeCheck is timeGetMoney minus 3 days**
    - **Validates: Requirements 3.5**
    - Dùng `fc.date({ min: new Date('2020-01-04'), max: new Date('2030-12-31') })`
    - Assert `data.timeCheck === moment(date).subtract(3, 'days').format('DD-MM-YYYY')`
    - Tag: `Feature: consignment-confirmation-email, Property 2: timeCheck is timeGetMoney minus 3 days`

  - [ ]\* 1.5 Viết property test — Property 3: productList mapping 1-1
    - **Property 3: productList maps 1-1 to products array**
    - **Validates: Requirements 3.6**
    - Dùng `fc.array(arbitraryRawProduct(), { minLength: 0, maxLength: 20 })`
    - Assert `data.products.length === productList.length`
    - Assert từng item: `p.amount === rawProduct.count`, `p.status === rawProduct.rateNew`
    - Tag: `Feature: consignment-confirmation-email, Property 3: productList maps 1-1 to products`

- [x] 2. Implement `sendConfirmationEmail` và export `sendConsignmentEmail` trong `mail.ts`
  - [x] 2.1 Implement hàm internal `sendConfirmationEmail`
    - Không export — dùng nội bộ và re-export để `consignment/index.ts` import
    - Lấy `consigner` qua `consignment.getConsigner()`
    - Kiểm tra email: nếu không có thì `console.warn` và return sớm
    - Gọi `buildEmailData(consignment)` → `data`
    - Render HTML bằng `ejs.renderFile(EMAIL_PATHS[EMAIL_TYPES.CONSIGNMENT], data)`
    - Gọi `emailFactory.send({ mailTo: email, title: \`Give Away Premium - Biên nhận ký gửi ${consignment.id}\`, html })`
    - Bọc toàn bộ trong `try/catch`, `console.error` khi lỗi, **không re-throw**
    - Import `* as ejs from 'ejs'` và `EMAIL_PATHS`, `EMAIL_TYPES` từ `../../constants`
    - _Requirements: 1.1, 1.3, 1.4, 3.1–3.7_

  - [x] 2.2 Export `sendConfirmationEmail` và implement `sendConsignmentEmail` Cloud Function handler
    - Export `sendConfirmationEmail` (để `consignment/index.ts` import được)
    - Implement `sendConsignmentEmail`: nhận `{ consignmentId }`, query Consignment include consigner
    - Nếu không tìm thấy: throw `new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, ...)`
    - Nếu tìm thấy: `await sendConfirmationEmail(consignment)`, return `{ success: true }`
    - Export `sendConsignmentEmail`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]\* 2.3 Viết property test — Property 4: sendConfirmationEmail không bao giờ throw
    - **Property 4: sendConfirmationEmail never throws externally**
    - **Validates: Requirements 1.4, 4.2**
    - Dùng `fc.string()` (random error message) + `fc.boolean()` (renderFile vs send throws)
    - Mock `ejs.renderFile` và `emailFactory.send` bằng jest.fn()
    - Assert `await expect(sendConfirmationEmail(mockConsignment)).resolves.not.toThrow()`
    - Tag: `Feature: consignment-confirmation-email, Property 4: sendConfirmationEmail never throws`

  - [ ]\* 2.4 Viết property test — Property 5: emailFactory.send gọi với mailTo đúng
    - **Property 5: emailFactory.send called with correct mailTo**
    - **Validates: Requirements 1.1, 2.2**
    - Dùng `fc.emailAddress()` để generate email hợp lệ
    - Mock `emailFactory.send`, tạo consignment với email tương ứng
    - Assert `mockEmailSend` được gọi đúng 1 lần với `expect.objectContaining({ mailTo: email })`
    - Tag: `Feature: consignment-confirmation-email, Property 5: emailFactory.send called with correct mailTo`

  - [ ]\* 2.5 Viết unit tests cho `sendConfirmationEmail`
    - Test: không gọi `emailFactory.send` khi consigner không có email
    - Test: gọi `emailFactory.send` với `mailTo` đúng khi email tồn tại
    - Test: không throw khi `emailFactory.send` reject
    - Test: không throw khi `ejs.renderFile` reject
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 3. Checkpoint — Kiểm tra mail.ts
  - Đảm bảo tất cả tests trong `mail.spec.ts` pass, ask the user if questions arise.

- [x] 4. Cập nhật `consignment/index.ts` — gọi email fire-and-forget trong `afterCreate`
  - [x] 4.1 Import `sendConfirmationEmail` và gọi fire-and-forget trong `afterCreate`
    - Thêm import: `import { sendConfirmationEmail } from '../function/mail';`
    - Trong `afterCreate`, sau `await Promise.all(promises)`, thêm: `sendConfirmationEmail(consignment);` — **không await**
    - Không thêm try/catch ở ngoài (đã handle bên trong hàm)
    - Verify không có circular dependency: `mail.ts` không import từ `consignment/index.ts`
    - _Requirements: 1.1, 4.1, 4.2, 4.3_

  - [ ]\* 4.2 Viết unit test cho fire-and-forget pattern trong `afterCreate`
    - Test: `sendConfirmationEmail` được gọi (không await) khi `context.isNew === true`
    - Test: `afterSave` hoàn thành ngay cả khi email async chưa xong (dùng artificial delay)
    - _Requirements: 4.1, 4.3_

- [x] 5. Đăng ký Cloud Function `sendConsignmentEmail` trong `main.ts`
  - [x] 5.1 Import và register `sendConsignmentEmail` trong `src/cloud/main.ts`
    - Thêm `sendConsignmentEmail` vào destructure import từ `'./function/mail'`
    - Thêm `Parse.Cloud.define<...>('sendConsignmentEmail', sendConsignmentEmail, { ... })` với:
      - `requireUser: true`
      - `fields.consignmentId`: `type: String`, `required: true`, `options: (val) => !!val`, `error: 'consignmentId là bắt buộc và không được rỗng'`
    - _Requirements: 5.1, 5.2, 5.3, 2.4_

  - [ ]\* 5.2 Viết integration test cho registration trong `main.ts`
    - Test: Cloud Function `sendConsignmentEmail` được register với `requireUser: true`
    - Test: validation schema reject empty string cho `consignmentId`
    - _Requirements: 5.1, 5.3_

- [x] 6. Final Checkpoint — Toàn bộ test suite
  - Đảm bảo tất cả tests pass (unit + property-based), ask the user if questions arise.

## Notes

- Tasks đánh dấu `*` là optional — có thể skip để ra MVP nhanh hơn
- Mỗi task tham chiếu requirements cụ thể để đảm bảo traceability
- Property tests dùng `fast-check` với `numRuns: 100` mỗi property
- `sendConfirmationEmail` phải được export từ `mail.ts` để `consignment/index.ts` import
- Fire-and-forget an toàn vì `sendConfirmationEmail` catch tất cả errors nội bộ — không gây unhandled rejection
- Dependency chain một chiều: `mail.ts` ← `consignment/index.ts` ← `main.ts`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3", "2.4", "2.5", "4.1"] },
    { "id": 5, "tasks": ["4.2", "5.1"] },
    { "id": 6, "tasks": ["5.2"] }
  ]
}
```
