import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Đọc CORS_ORIGIN từ env — comma-separated list
  // VD: CORS_ORIGIN=https://giveawaypremium.com.vn,https://www.giveawaypremium.com.vn
  const rawOrigins = process.env.CORS_ORIGIN || '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.enableCors({
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    // Nếu không set CORS_ORIGIN → cho phép tất cả (dev mode)
    // Nếu có → chỉ cho phép các domain trong list
    origin:
      allowedOrigins.length === 0
        ? '*'
        : (origin, callback) => {
            // Cho phép request không có origin (server-to-server, curl, Postman)
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            return callback(new Error(`CORS blocked: ${origin}`), false);
          },
  });

  const port = process.env.PORT || 1337;
  await app.listen(port);
  console.log(`Server is running on port ${port}`);
}
bootstrap();
