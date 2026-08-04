import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Restrict CORS theo CORS_ORIGIN env (comma-separated)
  // Ví dụ: CORS_ORIGIN=http://localhost:3000,https://giveawaypremium.com.vn
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : [];

  app.enableCors({
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    preflightContinue: false,
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    optionsSuccessStatus: 204,
  });

  const port = process.env.PORT || 1337;
  await app.listen(port);
  console.log(`Server is running on port ${port}`);
}
bootstrap();
