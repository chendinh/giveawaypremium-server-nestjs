# GiveAwayPremium — Server Overview

## Business Domain

Nền tảng thương mại điện tử hàng cao cấp (luxury e-commerce):

- **Ký gửi (Consignment):** Khách hàng ký gửi hàng hiệu để bán lại
- **Campaign:** Chiến dịch giveaway/flash sale sản phẩm
- **Order:** Quản lý đơn hàng, tích hợp vận chuyển
- **Appointment:** Đặt lịch hẹn tư vấn/nhận hàng

## Monorepo Structure

```
Desktop/
├── giveawaypremium-server-nestjs/   # Backend (THIS REPO)
└── giveawaypremium-client-nextjs/   # Frontend (Next.js)
```

## Tech Stack

| Layer         | Tech                                  |
| ------------- | ------------------------------------- |
| Framework     | NestJS v10                            |
| Database/Auth | Parse Server v7 + MongoDB             |
| Dashboard     | Parse Dashboard v7                    |
| Scheduler     | @nestjs/schedule + node-schedule      |
| Media         | Cloudinary v2                         |
| Email         | Nodemailer + Sendinblue (sib-api v3)  |
| Shipping      | GHTK (GiaoHangTietKiem) + ViettelPost |
| Product sync  | Nhanh.vn API                          |
| Logging       | Winston + winston-daily-rotate-file   |
| Templating    | EJS (email templates)                 |

## Environment Variables (.env)

```
# Parse Server
PARSE_SERVER_APPLICATION_ID=
PARSE_SERVER_MASTER_KEY=
PARSE_SERVER_DATABASE_URI=          # MongoDB URI
PARSE_SERVER_URL=                   # Public URL e.g. http://localhost:1337/api

# Parse Dashboard
PARSE_DASHBOARD_USER=
PARSE_DASHBOARD_PASSWORD=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
SENDINBLUE_API_KEY=

# Shipping
GHTK_TOKEN=
VIETTELPOST_TOKEN=
VIETTELPOST_USERNAME=
VIETTELPOST_PASSWORD=

# Nhanh.vn
NHANH_API_KEY=
NHANH_BUSINESS_ID=
NHANH_APP_ID=
```

## Key Conventions

- **Soft delete:** Set `deletedAt: Date` — never call Parse `.destroy()`
- **Cloud functions:** All triggers registered in `src/cloud/main.ts`
- **Master key:** Use `{ useMasterKey: true }` for server-side saves that bypass ACL
- **Queue pattern:** `p-queue` used for OrderRequest status updates to avoid race conditions
- **Logging:** Use Winston logger from `src/plugins/logger.ts`, logs to `logs/` directory
