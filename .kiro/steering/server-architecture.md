# Server Architecture — NestJS Backend

## Directory Structure

```
src/
├── app.module.ts           # Root module
├── app.controller.ts       # Health check endpoint
├── main.ts                 # Bootstrap: NestJS + Parse Server + CORS
├── cloud/                  # Parse Cloud Functions (triggers)
│   ├── main.ts             # Registers ALL cloud functions
│   ├── campaign/           # Campaign triggers
│   ├── consignment/        # Consignment triggers (afterSave creates Products)
│   ├── order/              # Order triggers (stock management + shipping)
│   ├── order-request/      # OrderRequest queue management
│   ├── product/            # Product triggers
│   ├── transporter/        # Shipping label triggers
│   ├── schedule/           # Scheduled jobs (cron via node-schedule)
│   ├── job/campaign/       # Job: activate campaigns
│   ├── nhanh-category/     # Nhanh.vn category sync
│   ├── nhanh-product-sync/ # Nhanh.vn product sync
│   ├── sub-category/       # SubCategory triggers
│   ├── external-config/    # ExternalConfig triggers
│   └── function/           # Parse.Cloud.define() functions (callable)
│       ├── administrative-units.ts  # VN provinces/districts/wards
│       ├── giaohangtietkiem.ts      # GHTK shipping functions
│       ├── guest-order.ts           # Guest checkout
│       ├── mail.ts                  # Send email functions
│       ├── product.ts               # Product query functions
│       └── transporter.ts           # Shipping management functions
├── models/                 # Parse.Object subclasses
│   ├── campaign.ts         # Campaign (PENDING | ACTIVE)
│   ├── category.ts
│   ├── consignment.ts      # Consignment (has consigner, consignee, group)
│   ├── consignment.group.ts
│   ├── email.ts
│   ├── external.config.ts
│   ├── media.ts
│   ├── nhanh.product.sync.ts
│   ├── order.ts            # Order (has productList[], transporter)
│   ├── order.request.ts    # OrderRequest
│   ├── product.ts          # Product (count, remainNumberProduct, soldNumberProduct)
│   ├── sub.category.ts
│   └── transporter.ts      # Transporter (service, res, status)
├── config/                 # Config loaders (read .env)
│   ├── parse.config.ts
│   ├── cloudinary.config.ts
│   ├── email.config.ts
│   ├── ghtk.config.ts
│   ├── nhanh.config.ts
│   ├── schedule.config.ts
│   └── viettelpost.config.ts
├── constants/
│   ├── index.ts
│   ├── email.ts
│   ├── order-status.ts     # OrderRequestStatus enum
│   ├── user-roles.ts
│   └── units.json
├── external-services/      # Third-party integrations
│   ├── cloudinary/         # Image upload
│   ├── email/              # nodemailer + sendinblue
│   ├── nhanh/              # Nhanh.vn product/category sync
│   └── transporter/        # GHTK + ViettelPost shipping
├── hooks/                  # NestJS module: webhook receiver from Parse
│   ├── hooks.controller.ts
│   └── hooks.module.ts
├── media/                  # NestJS module: Cloudinary upload endpoint
│   ├── media.controller.ts
│   └── media.module.ts
├── parse/
│   └── parse.module.ts     # Initializes Parse Server + Dashboard
├── plugins/
│   └── logger.ts           # Winston logger
└── templates/email/        # EJS email templates
    ├── consignment.ejs
    ├── payment.ejs
    └── reminder1-4.ejs
```

## NestJS Modules

| Module           | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `ParseModule`    | Boots Parse Server + Parse Dashboard, registers cloud functions |
| `HooksModule`    | POST `/hooks/*` — receives Parse webhooks                       |
| `MediaModule`    | POST `/media/upload` — Cloudinary upload via multer             |
| `ScheduleModule` | `@nestjs/schedule` cron jobs                                    |

## Parse Cloud Function Patterns

### Triggers (auto-fire on DB events)

```ts
// Registered in cloud/main.ts
Parse.Cloud.beforeSave('Campaign', campaign.beforeSave);
Parse.Cloud.afterSave('Consignment', consignment.afterSave);
Parse.Cloud.afterFind('Order', order.afterFind);
```

### Callable Functions (client calls via `Parse.Cloud.run()`)

```ts
// Defined in cloud/function/*.ts
Parse.Cloud.define('getProvinces', administrativeUnits.getProvinces);
Parse.Cloud.define('sendConsignmentEmail', mail.sendConsignmentEmail);
Parse.Cloud.define('createGHTKOrder', giaohangtietkiem.createOrder);
```

## Key Business Logic

### Consignment → Product creation

When a `Consignment` is saved (isNew=true), `afterSave` auto-creates individual
`Product` records from `consignment.productList[]`. Each product gets:

- `remainNumberProduct = count` (initial stock)
- `soldNumberProduct = 0`
- Pointer back to `consignment`, `consigner`, `consignee`, `category`

### Order → Stock management

On `Order` create: decrements `product.remainNumberProduct`, increments `soldNumberProduct`
On `Order` delete (soft-delete via `deletedAt`): reverses stock + cancels shipping

### Soft Delete pattern

All deletes set `deletedAt: Date` on the object, NOT a real Parse destroy.
`beforeSave` detects `dirty('deletedAt')` and sets `context.isDeleted = true`.

### Shipping flow

1. Create `Transporter` object with service ('giaohangtietkiem' | 'viettelpost') + res
2. Link to `Order` via pointer
3. `afterFind` on Order auto-refreshes shipping status from provider API

## REST Endpoints (NestJS)

| Method | Path            | Module | Description          |
| ------ | --------------- | ------ | -------------------- |
| GET    | `/`             | App    | Health check         |
| POST   | `/media/upload` | Media  | Upload to Cloudinary |
| POST   | `/hooks/nhanh`  | Hooks  | Nhanh.vn webhook     |

## Parse Server Dashboard

- URL: `PARSE_DASHBOARD_URL` (typically `/dashboard`)
- Requires master key auth
