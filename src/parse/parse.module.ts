import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ParseServer } from 'parse-server';
import ParseDashboard from 'parse-dashboard';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({})
export class ParseModule implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService
  ) {}

  private get<T = string>(key: string, fallback: T): T {
    return this.configService.get<T>(key) ?? fallback;
  }

  async onModuleInit() {
    const expressApp = this.httpAdapterHost.httpAdapter.getInstance();

    const serverURL = this.get('SERVER_URL', 'http://localhost:1337/api');
    const appId = this.get('APP_ID', 'myAppId');
    const masterKey = this.get('MASTER_KEY', 'myMasterKey');
    const cloudPath = this.get(
      'CLOUD',
      path.resolve(__dirname, '../cloud/main.js')
    );

    if (!process.env.SERVER_URL) {
      console.warn(
        `SERVER_URL not set, using default: ${serverURL}`
      );
    }

    if (!process.env.PARSE_DASHBOARD_PASSWORD) {
      console.warn(
        'PARSE_DASHBOARD_PASSWORD not set, using default credentials. ' +
          'Please set PARSE_DASHBOARD_PASSWORD in your .env file for security.'
      );
    }

    const parseServer = new ParseServer({
      databaseURI: this.get(
        'DATABASE_URI',
        'mongodb://localhost:27017/giveawaypremium'
      ),
      cloud: cloudPath,
      appId,
      masterKey,
      clientKey: this.get('CLIENT_KEY', 'myClientKey'),
      javascriptKey: this.get('JAVASCRIPT_KEY', 'myJavascriptKey'),
      restAPIKey: this.get('REST_API_KEY', 'myRestAPIKey'),
      serverURL,
      allowClientClassCreation:
        this.configService.get('ALLOW_CLIENT_CLASS_CREATION') !== 'false',
      liveQuery: {
        classNames: ['Channel'],
      },
    });

    // Parse Server 6.0+ requires start() to initialize internal state
    await parseServer.start();

    const dashboard = new ParseDashboard(
      {
        apps: [
          {
            serverURL,
            appId,
            masterKey,
            appName: this.get('APP_NAME', 'GiveawayPremium'),
          },
        ],
        users: [
          {
            user: this.get('PARSE_DASHBOARD_USERNAME', 'admin'),
            pass: this.get(
              'PARSE_DASHBOARD_PASSWORD',
              'admin@giveawaypremium2021'
            ),
          },
        ],
        trustProxy: parseInt(
          this.get('PARSE_DASHBOARD_TRUST_PROXY', '1')
        ),
        useEncryptedPasswords:
          this.configService.get('PARSE_DASHBOARD_ENCRYPTED') === 'true',
      },
      {
        allowInsecureHTTP:
          this.configService.get('PARSE_DASHBOARD_INSECURE_HTTP') === 'false'
            ? false
            : true,
        cookieSessionSecret: this.get(
          'PARSE_DASHBOARD_COOKIE_SESSION_SECRET',
          'myCookieSessionSecret'
        ),
      }
    );

    expressApp.use('/api', parseServer.app);
    expressApp.use('/dashboard', dashboard);

    console.log(`Parse Server running at ${serverURL}`);
    console.log(`Parse Dashboard at /dashboard`);
    console.log(`App ID: ${appId}`);

    // Create LiveQuery server
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    ParseServer.createLiveQueryServer(httpServer);
  }
}
