# Design Document

## Overview

Tính năng bổ sung Cloud function `sendPaymentConfirmationEmail` trên backend và nút "Gửi email đã trả tiền" trong `TableConsignmentScreen` trên frontend. Khi admin bấm nút, hệ thống gọi Cloud function, function query Consignment (include consigner), render template `payment.ejs` với đầy đủ dữ liệu (bao gồm `note`), và gửi email đến consigner.

Template `payment.ejs` đã tồn tại nhưng thiếu field `note`. Cloud function `sendConsignmentEmail` (file `src/cloud/function/mail.ts`) là mẫu tham chiếu chính — feature mới nhân bản pattern đó với template và dữ liệu khác.

---

## Architecture

```
[Admin UI]
  TableConsignmentScreen
    DropdownMenuItem "Gửi email đã trả tiền"
      → handleSendPaymentEmail(item.objectId)
        → GapService.sendPaymentConfirmationEmail(objectId)
          → POST /functions/sendPaymentConfirmationEmail
            → Parse Cloud: sendPaymentConfirmationEmail handler
              → Query Consignment + include('consigner')
              → Build PaymentEmailData
              → ejs.renderFile(payment.ejs, data)
              → NodemailerFactory.send()
```

---

## Components

### 1. Backend — `src/cloud/function/mail.ts`

Thêm interface `PaymentEmailData` và hàm `sendPaymentConfirmationEmail`.

```typescript
export interface PaymentEmailData {
  customerName: string;
  phoneNumber: string;
  identityId: string;
  consignmentId: string;
  numberOfProduct: number;
  bankName: string;
  bankId: string;
  moneyBack: string; // đã format: "1,000,000 vnd"
  note: string; // "---" nếu rỗng
}

export const sendPaymentConfirmationEmail = async (
  request: Parse.Cloud.FunctionRequest<{ consignmentId: string }>
): Promise<{ success: boolean }> => {
  const { consignmentId } = request.params;

  // 1. Query Consignment + consigner
  const query = new Parse.Query(Consignment);
  const consignment = await query
    .equalTo('objectId', consignmentId)
    .include('consigner')
    .first({ useMasterKey: true });

  if (!consignment) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      `Consignment ${consignmentId} không tồn tại`
    );
  }

  // 2. Lấy email (fire-and-forget nếu không có email)
  const consigner = consignment.getConsigner();
  if (!consigner) {
    console.error(
      `[sendPaymentConfirmationEmail] consignment ${consignmentId} không có consigner`
    );
    return { success: true };
  }
  const email =
    (consigner.get('email') as string) || (consigner.get('mail') as string);
  if (!email) {
    console.error(
      `[sendPaymentConfirmationEmail] consigner ${consigner.id} không có email`
    );
    return { success: true };
  }

  // 3. Build data
  const productList: any[] = consignment.get('productList') ?? [];
  const rawMoneyBack = (consignment.get('moneyBack') as number) ?? 0;
  const rawNote = (consignment.get('note') as string) ?? '';

  const data: PaymentEmailData = {
    customerName: consigner.get('name') ?? '',
    phoneNumber: consigner.get('phone') ?? '',
    identityId: consigner.get('identityId') ?? '',
    consignmentId: consignment.id,
    numberOfProduct: productList.length,
    bankName: consignment.get('bankName') ?? '',
    bankId: consignment.get('bankId') ?? '',
    moneyBack: rawMoneyBack
      ? `${rawMoneyBack.toLocaleString('vi-VN')} vnd`
      : '0 vnd',
    note: rawNote || '---',
  };

  // 4. Render + send (fire-and-forget trên exception email)
  try {
    const html = await ejs.renderFile(EMAIL_PATHS[EMAIL_TYPES.PAYMENT], data);
    await emailFactory.send({
      mailTo: email,
      title: 'Xác nhận chuyển khoản',
      html,
    });
  } catch (error) {
    console.error(
      `[sendPaymentConfirmationEmail] Lỗi gửi email consignment ${consignmentId}:`,
      error
    );
  }

  return { success: true };
};
```

**Lưu ý:** `emailFactory` dùng singleton đã có sẵn trong file `mail.ts` — không tạo thêm instance mới.

---

### 2. Backend — `src/cloud/main.ts`

Thêm import và đăng ký Cloud function:

```typescript
import {
  remiderIndividualConsignment,
  reminderConsignmentGroup,
  sendConsignmentEmail,
  sendPaymentConfirmationEmail, // ← thêm
} from './function/mail';

// ... (giữ nguyên các định nghĩa hiện có)

Parse.Cloud.define<(param: { consignmentId: string }) => { success: boolean }>(
  'sendPaymentConfirmationEmail',
  sendPaymentConfirmationEmail,
  {
    requireUser: true,
    fields: {
      consignmentId: {
        required: true,
        type: String,
        options: (val: string) => !!val,
        error: 'consignmentId là bắt buộc và không được rỗng',
      },
    },
  }
);
```

---

### 3. Backend — `src/templates/email/payment.ejs`

Bổ sung field `note` vào phần body (template đã có, chỉ thêm 1 dòng):

```html
<!-- thêm sau dòng moneyBack -->
<p><%= 'Ghi chú: ' + note; %></p>
```

---

### 4. Frontend — `src/app/actions/GapServices.ts`

Thêm static method `sendPaymentConfirmationEmail` vào class `GapService`. Pattern theo `sendEmailTongketWithObjectId` hiện có (gọi Cloud function với `useAuth: true`):

```typescript
static async sendPaymentConfirmationEmail(consignmentObjectId: string): Promise<any> {
  const body = { consignmentId: consignmentObjectId };
  return this.fetchData(
    '/functions/sendPaymentConfirmationEmail',
    REQUEST_TYPE.POST,
    null,
    body,
    null,
    null,
    null,
    true  // useAuth: true — gửi X-Parse-Session-Token
  );
}
```

---

### 5. Frontend — `TableConsignmentScreen/index.tsx`

**Handler mới** (thêm sau `handleSendEmail`):

```typescript
// ── Send payment confirmation email ──
const handleSendPaymentEmail = async (item: ConsignmentItem) => {
  try {
    await GapService.sendPaymentConfirmationEmail(item.objectId);
    toast.success('Đã gửi email xác nhận thanh toán');
  } catch {
    toast.error('Có lỗi khi gửi email');
  }
};
```

**DropdownMenuItem mới** (thêm vào `DropdownMenuContent` của cột Thao tác, sau item "Gửi email tổng kết"):

```tsx
<DropdownMenuItem
  onClick={() => handleSendPaymentEmail(item)}
  className="text-green-600"
>
  <DollarSign className="h-4 w-4 mr-2" />
  Gửi email đã trả tiền
</DropdownMenuItem>
```

`DollarSign` đã được import sẵn trong file (`import { ..., DollarSign, ... } from 'lucide-react'`).

---

## Data Flow

```
Consignment (Parse DB)
  ├── objectId → consignmentId (param)
  ├── consigner (User, include)
  │     ├── name → customerName
  │     ├── phone → phoneNumber
  │     ├── identityId → identityId (CMND)
  │     └── email / mail → mailTo
  ├── productList[] → length → numberOfProduct
  ├── bankName → bankName
  ├── bankId → bankId
  ├── moneyBack (number, nghìn đồng) → format → "X,XXX,XXX vnd"
  └── note (string) → note (fallback "---")
```

---

## Error Handling

| Tình huống                               | Hành vi                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `consignmentId` không tồn tại            | Throw `Parse.Error.OBJECT_NOT_FOUND` — client nhận lỗi       |
| `consigner` null (pointer không include) | Log error, return `{ success: true }` — fire-and-forget      |
| `consigner` không có email/mail          | Log error, return `{ success: true }` — fire-and-forget      |
| Gửi email thất bại (SMTP error)          | Log error, không re-throw — caller không biết email thất bại |
| Frontend: API lỗi                        | `toast.error('Có lỗi khi gửi email')`                        |
| Frontend: API thành công                 | `toast.success('Đã gửi email xác nhận thanh toán')`          |

---

## File Changes Summary

| File                                                 | Loại thay đổi | Mô tả                                                                 |
| ---------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| `src/cloud/function/mail.ts`                         | Thêm          | Interface `PaymentEmailData`, function `sendPaymentConfirmationEmail` |
| `src/cloud/main.ts`                                  | Sửa           | Import + đăng ký `sendPaymentConfirmationEmail`                       |
| `src/templates/email/payment.ejs`                    | Sửa           | Thêm dòng `Ghi chú: <%= note %>`                                      |
| `src/app/actions/GapServices.ts`                     | Thêm          | Static method `sendPaymentConfirmationEmail`                          |
| `src/app/admin/.../TableConsignemntScreen/index.tsx` | Sửa           | Handler + DropdownMenuItem mới                                        |
