import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}
