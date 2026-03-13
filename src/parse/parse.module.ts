import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ParseServer } from 'parse-server';
import ParseDashboard from 'parse-dashboard'
import { parseServerConfig, parseDashboardConfig, parseDashboardOptions } from '../config/parse.config';

@Module({})
export class ParseModule implements OnModuleInit {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const app = this.httpAdapterHost.httpAdapter.getInstance();

    if (!process.env.SERVER_URL) {
      console.warn('SERVER_URL not set, using default http://localhost:1337/api');
    }

    if (!process.env.PARSE_DASHBOARD_PASSWORD) {
      console.warn(
        'PARSE_DASHBOARD_PASSWORD not set, using default credentials. ' +
        'Please set PARSE_DASHBOARD_PASSWORD in your .env file for security.',
      );
    }

    const api = new ParseServer(parseServerConfig);
    const dashboard = new ParseDashboard(parseDashboardConfig, parseDashboardOptions);

    app.use('/api', api.app);
    app.use('/dashboard', dashboard);
    // Create LiveQuery server
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    ParseServer.createLiveQueryServer(httpServer);
  }
}
