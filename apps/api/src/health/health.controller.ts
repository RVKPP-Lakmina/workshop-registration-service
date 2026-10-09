import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'UNHEALTHY',
        message: 'Database or Redis unreachable',
      });
    }
  }
}
