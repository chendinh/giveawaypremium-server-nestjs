import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      status: 'ok',
      api: '/parse',
      dashboard: '/dashboard',
      docs: {
        note: 'Parse Server API is mounted at /api',
        example: {
          health: 'GET /api/health',
          classes: 'GET /api/classes/<ClassName>',
          functions: 'POST /api/functions/<functionName>',
        },
        headers: {
          'X-Parse-Application-Id': 'your-app-id',
          'X-Parse-JavaScript-Key': 'your-js-key',
        },
      },
    };
  }
}
