# Báo cáo kiểm kê tháng & Đối chiếu SePay

## Tổng quan

Route `/admin/bao-cao` (client) hiển thị báo cáo kiểm kê một tháng cho quản lý/giám
đốc: doanh thu, lợi nhuận, chi phí, tiền shop đang giữ, và đối chiếu với sao kê
ngân hàng qua SePay. Toàn bộ logic nằm ở `src/cloud/function/report/`.

**Quyền:** mọi cloud function trong tính năng này yêu cầu `role === 'administrator'`
(`requireAdminRole`, không dùng Master Key trực tiếp từ client).

## Mô hình ký gửi — công thức tính tiền (quan trọng, đừng tính sai)

Shop **không sở hữu hàng**, chỉ ăn phí hoa hồng trên phần hàng **đã bán thực tế**.
Vì vậy KHÔNG lấy "tổng giá trị nếu bán hết lô ký gửi" (các field
`moneyBackForFullSold`, `totalMoney`, `numberOfPoducts` trên `Consignment`) làm
doanh thu. Mọi số liệu doanh thu/lợi nhuận trong báo cáo đều tính theo **Order**
(đơn đã bán):

```
revenueVnd (doanh thu)     = Order.totalMoneyForSale         (đã ×1000 ra VND)
consignerShareVnd          = Order.totalMoneyForSaleAfterFee (phần trả lại khách)
                              — fallback convertPriceAfterFee() nếu đơn cũ thiếu field
feeVnd (LỢI NHUẬN chính)    = revenueVnd − consignerShareVnd
```

`feeVnd` dồn tích theo **ngày tạo đơn** trong tháng, không phụ thuộc việc tiền đã
thực trả cho khách ký gửi hay chưa (shop thường 1–2 tháng mới trả một lần — xem
`DerivedPayout`/`timeConfirmGetMoney`, tính theo ngày **xác nhận trả**, có thể lệch
tháng với ngày bán).

```
profit.netVnd (lợi nhuận sau chi phí) = Σ feeVnd (tháng) − MonthlyExpense.totalVnd
holding.surplusVnd (tiền thực của shop) = số dư ngân hàng − unpaidToConsignersVnd
```

`unpaidToConsignersVnd` **không** cộng toàn bộ lịch sử: chỉ tính ký gửi "chưa trả"
tạo từ `UNPAID_TRACKING_START` (`holding.ts`, hiện là 2026-10-01 giờ VN) — quyết
định nghiệp vụ của chủ shop, dữ liệu ký gửi trước mốc này không tính/không rà
soát nữa.

**Vì sao có mốc này:** quét toàn bộ lịch sử từng gặp 1 ký gửi từ 2021 nhập giá
sản phẩm sai đơn vị (ghi theo VND đầy đủ thay vì nghìn đồng) khiến `moneyBack`
bị nhân lệch 1000 lần (2,64 tỷ thay vì ~2,64 triệu); cộng chung với hàng trăm ký
gửi cũ không có `isGetMoney` được cập nhật, tổng "chưa trả" từ toàn bộ lịch sử
lên tới ~2,99 **nghìn tỷ** đồng. Thay vì dò sửa từng bản ghi cũ, chủ shop chọn
bỏ hẳn dữ liệu trước tháng 10/2026. Nếu cần đổi mốc, sửa `UNPAID_TRACKING_START`
trong `holding.ts`.

Chi tiết implement: `src/cloud/function/report/derive.ts` (deriveOrder/derivePayout),
`monthly-report.ts` (lắp totals/profit), `holding.ts` (số dư ngân hàng vs nợ khách),
`expenses.ts` (chi phí tháng do quản lý nhập — model `MonthlyExpense`).

## SePay — cấu hình đối chiếu

### Webhook (nhận giao dịch realtime)

```
URL cấu hình trên my.sepay.vn → Webhooks:  POST https://<domain>/hooks/sepay
Sự kiện: chọn "Cả hai" (tiền vào + tiền ra) — thiếu "tiền ra" sẽ không đối
         chiếu được phần trả khách ký gửi.
```

Chọn **một** kiểu xác thực, set đúng biến môi trường tương ứng — thiếu cả hai thì
server từ chối (fail-closed) mọi webhook SePay:

| Kiểu xác thực             | Header SePay gửi                                        | Env server              |
| ------------------------- | ------------------------------------------------------- | ----------------------- |
| HMAC-SHA256 (khuyến nghị) | `X-SePay-Signature: sha256=<hex>` + `X-SePay-Timestamp` | `SEPAY_WEBHOOK_SECRET`  |
| API Key                   | `Authorization: Apikey <key>`                           | `SEPAY_WEBHOOK_API_KEY` |

HMAC ký trên **raw body** (`{timestamp}.{raw_body}`) — đây là lý do `main.ts` và
`api/index.ts` (Vercel) đều bật `rawBody: true` khi tạo Nest app. Nếu đổi sang
dùng `body-parser`/middleware khác trước route `/hooks/sepay`, nhớ giữ raw body
hoặc chữ ký sẽ luôn sai.

### API v2 (bù dữ liệu cũ / số dư tài khoản)

```
Base URL: https://userapi.sepay.vn/v2  (SEPAY_API_URL, đổi khi dùng sandbox)
Auth: Authorization: Bearer <SEPAY_API_TOKEN>   (my.sepay.vn → API Access)
Rate limit: 3 request/giây/IP
```

- `GET /transactions` — dùng trong "Đồng bộ từ SePay" trên UI (cloud function
  `syncSepayTransactions`) để bù giao dịch của giai đoạn **trước khi** webhook
  được cấu hình (webhook chỉ gửi giao dịch phát sinh sau khi bật).
- `GET /bank-accounts` — lấy số dư hiện tại (`holding.bankBalanceVnd`). Nếu
  `SEPAY_API_TOKEN` chưa cấu hình, server fallback dùng `accumulatedVnd` của giao
  dịch gần nhất đã đồng bộ (kém chính xác hơn, một số ngân hàng SMS không báo số
  dư nên SePay trả `0` — xem `holding.ts`).

`SEPAY_ACCOUNT_NUMBERS` (tuỳ chọn, cách nhau bằng dấu phẩy): giới hạn chỉ tính các
tài khoản ngân hàng của shop, phòng trường hợp công ty SePay có liên kết tài khoản
khác không liên quan đến shop này.

### Chống trùng giao dịch

ID giao dịch của **webhook** (số nguyên) và của **API v2** (UUID) khác nhau cho
cùng một giao dịch ngân hàng, nên không dùng ID để chống trùng. `BankTransaction`
dùng `fingerprint` = hash(số tài khoản, mã tham chiếu, thời điểm theo giây, chiều,
số tiền) — xem `sepay.normalize.ts#buildFingerprint`. `cloud/bank-transaction/upsert.ts`
dùng hàng đợi 1 luồng (`p-queue`) + kiểm tra fingerprint trước khi tạo.

## Đối chiếu (matcher)

`cloud/function/report/matcher.ts` — thuần, không đụng DB, dễ test riêng.

1. **Quyết định thủ công** (`linkBankTransaction`/`unlinkBankTransaction`) luôn
   được giữ nguyên, không bao giờ bị auto-match ghi đè.
2. **Lượt A**: ghép 1-1 theo số tiền (sai lệch ≤ 1.000đ do làm tròn giá) trong
   cửa sổ thời gian (tiền vào ±3 ngày, tiền ra ±7 ngày so với ngày tạo đơn/ngày
   xác nhận trả), ưu tiên nội dung chuyển khoản có mã ký gửi/SĐT khách.
3. **Lượt B**: nội dung chuyển khoản nhắc đúng **một** đơn/ký gửi nhưng số tiền
   lệch → vẫn gán để lộ ra chênh lệch (thiếu/thừa), đánh dấu `mismatch`.

Chỉ tiền vào ↔ **đơn thu bằng chuyển khoản**, tiền ra ↔ **ký gửi đã đánh dấu trả
bằng chuyển khoản** mới được đưa vào đối chiếu — đơn/ký gửi trả tiền mặt không có
giao dịch ngân hàng để so.

## Files liên quan trong codebase

```
src/
├── common/vn-time.ts                           # Mốc tháng theo giờ VN (UTC+7)
├── config/sepay.config.ts                      # Đọc env SEPAY_* (đọc lúc gọi, không cache)
├── external-services/sepay/
│   ├── sepay.types.ts                           # Kiểu payload webhook / API v2
│   ├── sepay.normalize.ts                       # Chuẩn hoá + buildFingerprint
│   ├── sepay.webhook-auth.ts                    # Xác thực HMAC / API Key
│   └── sepay.client.ts                          # GET /transactions, /bank-accounts
├── models/
│   ├── bank.transaction.ts                      # Giao dịch NH đã nhận (chỉ server ghi)
│   ├── report.attachment.ts                     # Ảnh bill/sao kê đính kèm báo cáo
│   ├── monthly.expense.ts                       # Chi phí vận hành theo tháng
│   └── monthly.report.snapshot.ts               # Bản lưu báo cáo tháng đã qua (cache)
├── cloud/
│   ├── finance-guard/index.ts                   # Chặn REST/SDK client đụng 3 class trên
│   ├── bank-transaction/upsert.ts                # Ghi BankTransaction, chống trùng
│   └── function/report/
│       ├── derive.ts                            # Order/Consignment → số liệu báo cáo
│       ├── matcher.ts                            # Thuật toán ghép giao dịch (thuần)
│       ├── reconciliation.ts                     # Chạy matcher trên dữ liệu thật
│       ├── holding.ts                            # Số dư NH vs nợ khách ký gửi
│       ├── expenses.ts                           # CRUD chi phí tháng
│       ├── attachments.ts                        # CRUD ảnh đính kèm (soft-delete)
│       ├── bank-link.ts                          # link/unlink thủ công + đồng bộ API
│       ├── monthly-report.ts                     # Lắp ráp getMonthlyReport
│       ├── snapshot.ts                           # Đọc/ghi/xoá bản lưu tháng đã qua
│       └── types.ts                              # DTO trả về client
└── hooks/hooks.controller.ts                     # POST /hooks/sepay (webhook)
```

## Checklist khi bật SePay cho production

- [ ] Liên kết tài khoản ngân hàng của shop trong tài khoản SePay
- [ ] Tạo API Token (my.sepay.vn → API Access) → set `SEPAY_API_TOKEN`
- [ ] Tạo webhook, sự kiện "Cả hai", chọn HMAC-SHA256 → set `SEPAY_WEBHOOK_SECRET`
- [ ] (Tuỳ chọn) set `SEPAY_ACCOUNT_NUMBERS` nếu công ty SePay có tài khoản khác
      không thuộc shop
- [ ] Bấm "Gửi thử" trên trang quản lý webhook SePay, kiểm tra server trả 200
- [ ] Vào `/admin/bao-cao`, bấm "Đồng bộ từ SePay" cho các tháng cũ cần đối chiếu
      (webhook chỉ nhận giao dịch phát sinh SAU khi bật)

## Bản lưu báo cáo tháng đã qua (MonthlyReportSnapshot)

`getMonthlyReport` chỉ **tính trực tiếp** cho tháng hiện tại. Tháng đã qua (< tháng
hiện tại, giờ VN): lần đầu mở thì tính rồi lưu vào class `MonthlyReportSnapshot`
(`month` duy nhất, `payload` = JSON của báo cáo, `schemaVersion`); các lần sau đọc
thẳng từ bản lưu. Đây là **cache dẫn xuất, không phải dữ liệu gốc** — xoá đi thì lần
mở sau tự tính lại, nên là chỗ duy nhất trong feature này được xoá cứng (`destroy`).

- **Số liệu đóng băng** tại `cache.savedAt`: ví dụ khách ký gửi được xác nhận trả tiền
  muộn sau đó sẽ chưa hiện trong "đã trả/chưa trả" của tháng cũ cho tới khi tải lại.
  Nút "Tải lại" trên UI gọi `getMonthlyReport({ refresh: true })` để bỏ bản lưu và ghi đè.
- **Chi phí vận hành luôn lấy trực tiếp** rồi tính lại `profit.netVnd`, vì quản lý có
  thể sửa chi phí tháng cũ bất cứ lúc nào.
- **Tự xoá bản lưu** (kèm tháng kề bên nếu sát biên, theo `BANK_MARGIN_MS`) khi có giao
  dịch ngân hàng mới được nạp (`upsertBankTransactions`: webhook và đồng bộ SePay) hoặc
  khi gán/huỷ gán giao dịch (`linkBankTransaction`/`unlinkBankTransaction`).
- **Không lưu** khi đối chiếu ngân hàng bị lỗi (tránh đóng băng báo cáo khuyết).
- **Đổi cấu trúc `MonthlyReport` thì phải tăng `SNAPSHOT_SCHEMA_VERSION`**
  (`report/snapshot.ts`), nếu không bản lưu cũ sẽ trả về thiếu field mới.
- Class này nằm trong `finance-guard` (chỉ master key), client chỉ đi qua cloud function.

## Lưu ý khác

- Số tiền trả về từ mọi cloud function trong `report/` đã là **VND thật** (server
  tự nhân ×1000 từ đơn vị nghìn đồng lưu trong DB) — khác với `getOrderSummary`
  (SummaryScreen cũ) vẫn trả theo nghìn đồng và để client tự nhân.
- `BankTransaction`/`ReportAttachment`/`MonthlyExpense` bị `finance-guard` chặn
  hoàn toàn với client (REST/SDK thường) — mọi thao tác phải qua cloud function
  tương ứng, không tạo thêm field/route đọc trực tiếp 3 class này bằng session token.
