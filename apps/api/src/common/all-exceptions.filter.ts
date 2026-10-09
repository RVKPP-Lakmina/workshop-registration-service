import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { statusCode, code, message } = this.normalise(exception);
    if (statusCode >= 500) this.logger.error(exception);
    res.status(statusCode).json({ statusCode, code, message });
  }

  private normalise(exception: unknown) {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();
      const fallback = DEFAULT_CODES[statusCode] ?? 'ERROR';
      if (typeof body === 'object' && body !== null) {
        const b = body as { code?: string; message?: string | string[] };
        if (b.code && typeof b.message === 'string') {
          return { statusCode, code: b.code, message: b.message };
        }
        if (Array.isArray(b.message)) {
          return {
            statusCode,
            code: 'VALIDATION_ERROR',
            message: b.message.join('; '),
          };
        }
        return {
          statusCode,
          code: fallback,
          message: b.message ?? exception.message,
        };
      }
      return { statusCode, code: fallback, message: exception.message };
    }
    const err = exception as { code?: string; message?: string };
    if (
      err?.code === 'P2002' ||
      err?.message?.includes('workshops_capacity_check')
    ) {
      return {
        statusCode: 409,
        code: 'CONFLICT',
        message: 'The change conflicts with existing data',
      };
    }
    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    };
  }
}
