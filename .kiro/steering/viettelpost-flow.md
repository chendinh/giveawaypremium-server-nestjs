# ViettelPost Integration — Luồng & Bảo trì

## Môi trường

| Môi trường | URL                                    | Tài khoản                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------------ |
| **DEV**    | `https://partnerdev.viettelpost.vn/v2` | `account.dev.vtp.1785840507703@viettelpost.com` / `Vtp@1234` |
| **PROD**   | `https://partner2.viettelpost.vn/v2`   | `0703334443` / (xem .env production)                         |

**Luôn test trên DEV trước khi chuyển PROD.**
Khi deploy production: đổi `VIETTELPOST_URL` và `VIETTELPOST_USERNAME/PASSWORD` trong `.env`.

---

## Luồng xác thực token (quan trọng nhất)

```
Có 2 cách lấy long token:

CÁCH A — Username/Password (2 bước):
  POST /user/Login { USERNAME, PASSWORD }
      → short token (hết hạn ~24h)
  POST /user/ownerconnect { USERNAME, PASSWORD } + Header: Token = short token
      → long token (hết hạn ~2 năm)

CÁCH B — Secret key từ website (1 bước, khuyến nghị):
  Vào https://viettelpost.vn/cau-hinh-tai-khoan → Thêm mới token → copy
  POST /user/LoginVTP { token: "<secret_key>" }
      → long token trực tiếp
```

### Token được lưu ở đâu?

```
1. VIETTELPOST_TOKEN trong .env  ← fallback khi không có gì
2. ExternalConfig trong Parse DB  ← ưu tiên, tồn tại qua restart
   key = "VIETTELPOST_LONG_TOKEN"
3. cachedToken trong memory       ← dùng trong runtime
```

**Thứ tự ưu tiên khi server start:**

```
DB (ExternalConfig) → .env (VIETTELPOST_TOKEN) → auto login nếu có USERNAME/PASSWORD
```

---

## Cách refresh token khi hết hạn

### Cách nhanh nhất (gọi 1 lần từ Postman/curl):

```bash
# Bước 1: Login lấy short token
curl -X POST 'https://partner2.viettelpost.vn/v2/user/Login' \
  -H 'Content-Type: application/json' \
  -d '{"USERNAME":"0703334443","PASSWORD":"<password>"}'
# → lấy data.token

# Bước 2: Đổi long token
curl -X POST 'https://partner2.viettelpost.vn/v2/user/ownerconnect' \
  -H 'Content-Type: application/json' \
  -H 'Token: <short_token_bước_1>' \
  -d '{"USERNAME":"0703334443","PASSWORD":"<password>"}'
# → lấy data.token (long token, hết hạn ~2 năm)

# Bước 3: Update .env
VIETTELPOST_TOKEN=<long_token>
# Restart server
```

### Hoặc gọi qua Cloud Function (cần master key):

```bash
# Bước 1: Login
curl -X POST 'http://localhost:1337/parse/functions/transporter' \
  -H 'X-Parse-Application-Id: <APP_ID>' \
  -H 'X-Parse-Master-Key: <MASTER_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"service":"viettelpost","action":"LOGIN","data":{"username":"...","password":"..."}}'
# → lấy result.token

# Bước 2: Lấy long token (tự động lưu vào DB)
curl -X POST 'http://localhost:1337/parse/functions/transporter' \
  -H 'X-Parse-Application-Id: <APP_ID>' \
  -H 'X-Parse-Master-Key: <MASTER_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"service":"viettelpost","action":"GET_LONG_TOKEN","data":{"token":"<short_token>"}}'
# → long token tự động lưu vào ExternalConfig DB + cachedToken
# Không cần restart server
```

---

## Phân quyền Cloud Function `transporter`

| Action                | Quyền                        | Mục đích                              |
| --------------------- | ---------------------------- | ------------------------------------- |
| `PRICE_ESTIMATE`      | **Public** (không cần login) | Tính cước hiển thị cho khách          |
| `CREATE_ORDER`        | User đăng nhập               | Tạo vận đơn thật — tốn phí            |
| `CANCEL_ORDER`        | User đăng nhập               | Hủy vận đơn — tốn phí nếu đã lấy hàng |
| `GET_ORDER_LABEL`     | User đăng nhập               | In nhãn vận đơn                       |
| `LOGIN`               | **Master key only**          | Admin refresh token                   |
| `GET_LONG_TOKEN`      | **Master key only**          | Admin refresh token                   |
| `LOGIN_BY_SECRET_KEY` | **Master key only**          | Admin refresh token                   |

---

## Luồng tạo đơn hàng (happy path)

```
1. Client gọi PRICE_ESTIMATE
   → params: { weight, serviceLevel, from: {province, district, ward}, to: {...} }
   → Lưu ý: province/district/ward là NUMERIC ID từ API địa danh VTP
   → Hiển thị bảng giá cho user chọn dịch vụ (MA_DV_CHINH)

2. Admin tạo đơn → gọi CREATE_ORDER (cần session token)
   → params: { orderId: <Parse Order objectId>, service: 'viettelpost', data: { from, to, items, serviceLevel, ... } }
   → Server check: đơn chưa có vận đơn (Transporter chưa tồn tại)
   → Gọi VTP createOrder → nhận ORDER_NUMBER
   → Tạo Transporter object trong Parse DB { service, res: {..., ORDER_NUMBER}, order }
   → Transporter.beforeSave set status = 'WAITING_PICK_UP' (VTP status 102)

3. VTP xử lý → webhook push về /hooks/viettelpost
   → Xác thực TOKEN = VIETTELPOST_WEBHOOK_SECRET
   → Tìm Transporter theo ORDER_NUMBER
   → Update status theo VIETTELPOST_STATUS map
   → Nếu đã ở trạng thái cuối → bypass (idempotent)

4. Trạng thái cuối (không còn webhook nữa):
   101 (VTP từ chối) | 107 (Đối tác hủy) | 201 (Hủy nhập) |
   501 (Phát thành công) | 503 (Hủy theo KH) | 504 (Hoàn thành công)

5. In nhãn → gọi GET_ORDER_LABEL
   → POST /order/printing-code { ORDER_ARRAY: [ORDER_NUMBER], EXPIRY_TIME }
   → Nhận code → ghép URL: https://digitalize.viettelpost.vn/...?bill={code}
```

---

## Luồng hủy đơn

```
Chỉ hủy được khi ORDER_STATUS < 200 (và khác 105, 107)
Trạng thái có thể hủy: 102 (chờ xử lý), 103 (giao bưu cục), 104 (giao bưu tá đi nhận)

Gọi CANCEL_ORDER:
  → VTP: POST /order/UpdateOrder { TYPE: 4, ORDER_NUMBER, NOTE }
  → Parse: order.unset('transporter'), transporter.unset('order')
  → Webhook VTP sẽ push về với STATUS 107
```

---

## Địa danh (IDs quan trọng)

ViettelPost dùng **numeric ID** — KHÔNG phải tên string như GHTK.

```
API lấy ID:
  GET /categories/listProvinceById?provinceId=-1   → PROVINCE_ID
  GET /categories/listDistrict?provinceId={id}      → DISTRICT_ID
  GET /categories/listWards?districtId={id}         → WARDS_ID

Ví dụ HCM:
  PROVINCE_ID = 2
  Quận 1: DISTRICT_ID = 43
  P. Nguyễn Thái Bình: WARDS_ID = 773

Địa chỉ gửi hàng mặc định (GiveAwayPremium Q1):
  PROVINCE_ID: 2  (HCM)
  DISTRICT_ID: 43 (Quận 1)
  WARD_ID: 773    (P. Nguyễn Thái Bình)
  ADDRESS: "1 Phó Đức Chính, Quận 1, HCM"
  PHONE: "0703334443"
```

---

## Các dịch vụ thường dùng

| Mã     | Tên                       | Thời gian |
| ------ | ------------------------- | --------- |
| `LCOD` | TMĐT Tiết Kiệm thỏa thuận | 72 giờ    |
| `NCOD` | TMĐT Nhanh thỏa thuận     | 36 giờ    |
| `VCN`  | CP Nhanh thỏa thuận       | 36 giờ    |

Lấy đầy đủ từ API `getPriceAll` — danh sách thay đổi theo địa chỉ gửi/nhận.

---

## ORDER_PAYMENT — Loại vận đơn

| Giá trị | Ý nghĩa                          | Dùng khi                                          |
| ------- | -------------------------------- | ------------------------------------------------- |
| `1`     | Không thu hộ                     | Shop trả cước, không COD                          |
| `2`     | Thu hộ tiền hàng VÀ cước         | Khách trả cả 2                                    |
| `3`     | Thu hộ tiền hàng, KHÔNG thu cước | **Mặc định** — shop trả cước, khách trả tiền hàng |
| `4`     | Thu hộ cước, không thu tiền hàng | Ít dùng                                           |

**GiveAwayPremium dùng `ORDER_PAYMENT = 4`** (tiền hàng đã CK trước, khách trả cước khi nhận).

---

## Files liên quan trong codebase

```
src/
├── config/viettelpost.config.ts              # Đọc env vars
├── external-services/transporter/
│   ├── viettelpost.ts                        # VTP API client
│   ├── viettelpost.types.ts                  # TypeScript types
│   ├── viettelpost.token.service.ts          # Token persistence (DB + env)
│   └── interface.ts                          # VTPAddress (numeric), GHTKAddress (string)
├── cloud/
│   ├── function/transporter.ts              # Cloud functions + auth check
│   └── transporter/index.ts                 # Parse triggers (beforeSave/afterSave)
├── hooks/hooks.controller.ts                 # POST /hooks/viettelpost (webhook)
└── constants/order-status.ts               # VIETTELPOST_STATUS map, VTP_FINAL_STATUSES
```

---

## Checklist khi deploy production

- [ ] Đổi `VIETTELPOST_URL` → `https://partner2.viettelpost.vn/v2`
- [ ] Đổi `VIETTELPOST_USERNAME` → `0703334443`
- [ ] Đổi `VIETTELPOST_PASSWORD` → password production
- [ ] Lấy long token production và set `VIETTELPOST_TOKEN`
- [ ] Set `VIETTELPOST_WEBHOOK_SECRET` → secret key trên portal VTP
- [ ] Cấu hình webhook URL trên `partner2.viettelpost.vn` → `https://<domain>/hooks/viettelpost`
- [ ] Test `PRICE_ESTIMATE` → kết quả khác dev (giá thật)
- [ ] Gửi Checklist Go-live cho team VTP để duyệt webhook

## Checklist khi token hết hạn (dấu hiệu: API trả lỗi "Token invalid")

- [ ] Gọi `LOGIN` (master key) → lấy short token
- [ ] Gọi `GET_LONG_TOKEN` (master key) → long token tự lưu DB
- [ ] Hoặc update `VIETTELPOST_TOKEN` trong `.env` → restart server
