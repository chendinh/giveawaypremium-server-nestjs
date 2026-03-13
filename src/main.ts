import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    preflightContinue: false,
    origin: '*',
    optionsSuccessStatus: 204,
  });

  const port = process.env.PORT || 1337;
  await app.listen(port);
  console.log(`Server is running on port ${port}`);
}
bootstrap();
