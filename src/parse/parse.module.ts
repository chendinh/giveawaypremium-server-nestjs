import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ParseServer } from 'parse-server';
import ParseDashboard from 'parse-dashboard';
import { ConfigService } from '@nestjs/config';

// Singleton guard — tránh khởi tạo lại khi Vercel/serverless reinitialize module
let parseServerInstance: ParseServer | null = null;
let isInitialized = false;

@Module({})
export class ParseModule implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService
  ) {}

  onModuleInit() {
    if (isInitialized) {
      return;
    }
    isInitialized = true;

    const app = this.httpAdapterHost.httpAdapter.getInstance();

    if (!process.env.SERVER_URL) {
      console.warn(
        'SERVER_URL not set, using default https://hammerhead-app-dcydg.ondigitalocean.app/api'
      );
    }

    if (!process.env.PARSE_DASHBOARD_PASSWORD) {
      console.warn(
        'PARSE_DASHBOARD_PASSWORD not set, using default credentials. ' +
          'Please set PARSE_DASHBOARD_PASSWORD in your .env file for security.'
      );
    }

    parseServerInstance = new ParseServer({
      databaseURI: this.configService.get('DATABASE_URI'),
      cloud: this.configService.get('CLOUD') || './dist/cloud/main.js',
      appId: this.configService.get('APP_ID'),
      masterKey: this.configService.get('MASTER_KEY'),
      clientKey: this.configService.get('CLIENT_KEY'),
      javascriptKey: this.configService.get('JAVASCRIPT_KEY'),
      restAPIKey: this.configService.get('REST_API_KEY'),
      serverURL: this.configService.get('SERVER_URL'),
      liveQuery: {
        classNames: ['Channel'],
      },
    });

    parseServerInstance.start();

    const dashboard = new ParseDashboard(
      {
        apps: [
          {
            serverURL:
              this.configService.get('DASHBOARD_SERVER_URL') ||
              `http://localhost:${this.configService.get('PORT') || 1337}/parse`,
            appId: this.configService.get('APP_ID'),
            masterKey: this.configService.get('MASTER_KEY'),
            appName: this.configService.get('APP_NAME'),
          },
        ],
        users: [
          {
            user: this.configService.get('PARSE_DASHBOARD_USERNAME'),
            pass: this.configService.get('PARSE_DASHBOARD_PASSWORD'),
          },
        ],
        trustProxy: parseInt(
          this.configService.get('PARSE_DASHBOARD_TRUST_PROXY') || '1'
        ),
        useEncryptedPasswords:
          this.configService.get('PARSE_DASHBOARD_ENCRYPTED') === 'true',
      },
      {
        allowInsecureHTTP:
          this.configService.get('PARSE_DASHBOARD_INSECURE_HTTP') === 'false'
            ? false
            : true,
        cookieSessionSecret: this.configService.get(
          'PARSE_DASHBOARD_COOKIE_SESSION_SECRET'
        ),
      }
    );

    app.use('/parse', parseServerInstance.app);
    app.use('/dashboard', dashboard);

    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    ParseServer.createLiveQueryServer(httpServer);
  }
}
