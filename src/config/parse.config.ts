import * as path from 'path';

export const parseServerConfig = {
  databaseURI: process.env.DATABASE_URI,
  cloud: process.env.CLOUD || path.resolve(__dirname, '../cloud/main.js'),
  appId: process.env.APP_ID,
  masterKey: process.env.MASTER_KEY,
  clientKey: process.env.CLIENT_KEY,
  javascriptKey: process.env.JAVASCRIPT_KEY,
  restAPIKey: process.env.REST_API_KEY,
  serverURL: process.env.SERVER_URL,
  liveQuery: {
    classNames: ['Channel'],
  },
};

export const parseDashboardConfig = {
  apps: [
    {
      serverURL: process.env.SERVER_URL,
      appId: process.env.APP_ID,
      masterKey: process.env.MASTER_KEY,
      appName: process.env.APP_NAME || 'GiveawayPremium',
    },
  ],
  users: [
    {
      user: process.env.PARSE_DASHBOARD_USERNAME || 'administrator',
      // Password phải được set trong .env — không có fallback hardcode
      pass: process.env.PARSE_DASHBOARD_PASSWORD,
    },
  ],
  trustProxy: parseInt(process.env.PARSE_DASHBOARD_TRUST_PROXY || '1'),
  useEncryptedPasswords: process.env.PARSE_DASHBOARD_ENCRYPTED === 'true',
};

export const parseDashboardOptions = {
  allowInsecureHTTP:
    process.env.PARSE_DASHBOARD_INSECURE_HTTP === 'false' ? false : true,
  cookieSessionSecret:
    process.env.PARSE_DASHBOARD_COOKIE_SESSION_SECRET ||
    'myCookieSessionSecret',
};
