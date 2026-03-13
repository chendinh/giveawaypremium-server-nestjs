# GiveawayPremium Server (NestJS)

Backend server for GiveawayPremium, built with NestJS and Parse Server.

## Requirements

- **Node.js** >= 18 (recommended: 20)
- **MongoDB** running locally or a remote connection string

## Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and update the values:
   - `DATABASE_URI` – MongoDB connection string (required)
   - `SERVER_URL` – Must match the Parse Server mount path (default: `http://localhost:1337/api`)
   - `PARSE_DASHBOARD_USERNAME` / `PARSE_DASHBOARD_PASSWORD` – Credentials for the Parse Dashboard

3. **Start development server**:

   ```bash
   npm run start:dev
   ```

4. **Access the application**:
   - **Parse Server API**: `http://localhost:1337/api`
   - **Parse Dashboard**: `http://localhost:1337/dashboard`

## Parse Dashboard Login

Use the credentials defined in your `.env` file:
- **Username**: value of `PARSE_DASHBOARD_USERNAME` (default: `administrator`)
- **Password**: value of `PARSE_DASHBOARD_PASSWORD` (default: `admin`)

> **Important**: The `SERVER_URL` in your `.env` must use the `/api` path (not `/parse`), as Parse Server is mounted at `/api`.

## Scripts

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run start:dev`  | Start in development mode       |
| `npm run build`      | Build for production            |
| `npm run start:prod` | Start production server         |
| `npm run lint`       | Lint source files               |
| `npm run test`       | Run tests                       |
| `npm run format`     | Format code with Prettier       |

## Docker

```bash
docker-compose up --build
```

## Project Structure

```
src/
├── main.ts              # Application entry point
├── app.module.ts        # Root module
├── app.controller.ts    # Root controller
├── parse/               # Parse Server & Dashboard setup
├── cloud/               # Parse Cloud Code (triggers & functions)
├── config/              # Configuration files
├── constants/           # Constants and enums
├── models/              # Parse Object model definitions
├── hooks/               # Webhook controllers
├── media/               # Media upload module
├── external-services/   # Third-party service integrations
├── common/              # Shared utilities and filters
├── plugins/             # Logger and other plugins
└── templates/           # Email templates (EJS)
```
