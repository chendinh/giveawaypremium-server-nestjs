import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ParseModule } from './parse/parse.module';
import { HooksModule } from './hooks/hooks.module';
import { MediaModule } from './media/media.module';
import { ConsignmentModule } from './consignment/consignment.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ParseModule,
    HooksModule,
    MediaModule,
    ConsignmentModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
