import { Module } from '@nestjs/common';
import { ConsignmentController } from './consignment.controller';

@Module({
  controllers: [ConsignmentController],
})
export class ConsignmentModule {}
