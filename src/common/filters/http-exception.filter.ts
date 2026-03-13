import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { BaseError } from '../error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof BaseError) {
      status = exception.status;
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    console.error('error', JSON.stringify(exception));
    if (exception instanceof Error) {
      console.error('stack', exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
    });
  }
}
