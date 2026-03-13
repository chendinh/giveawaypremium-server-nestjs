import * as path from 'path';

export const parseServerConfig = {
  databaseURI: process.env.DATABASE_URI,
  cloud: process.env.CLOUD || path.resolve(__dirname, '../cloud/main.js'),
  appId: process.env.APP_ID || 'myAppId',
  masterKey: process.env.MASTER_KEY || 'myMasterKey',
  clientKey: process.env.CLIENT_KEY || 'myClientKey',
  javascriptKey: process.env.JAVASCRIPT_KEY || 'myJavascriptKey',
  restAPIKey: process.env.REST_API_KEY || 'myRestAPIKey',
  serverURL: process.env.SERVER_URL || 'http://localhost:1337/api',
  liveQuery: {
    classNames: ['Channel'],
  },
};

export const parseDashboardConfig = {
  apps: [
    {
      serverURL: process.env.SERVER_URL || 'http://localhost:1337/api',
      appId: process.env.APP_ID || 'myAppId',
      masterKey: process.env.MASTER_KEY || 'myMasterKey',
      appName: process.env.APP_NAME || 'GiveawayPremium',
    },
  ],
  users: [
    {
      user: process.env.PARSE_DASHBOARD_USERNAME || 'administrator',
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
