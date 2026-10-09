import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { envFilePaths, validate } from './config/index.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard, RolesGuard } from './auth/guards.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { AppThrottlerGuard } from './common/throttler.guard.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { REDIS, RedisModule } from './redis/redis.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkshopsModule } from './workshops/workshops.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths(),
      validate,
    }),
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis),
        // Evaluated per request: live process env first (tests flip it at runtime),
        // then the validated ConfigService value.
        skipIf: () => (process.env.THROTTLE_DISABLED ?? config.get<string>('THROTTLE_DISABLED')) === 'true',
      }),
    }),
    AuthModule,
    UsersModule,
    WorkshopsModule,
    RegistrationsModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: authenticate, then rate-limit by user, then authorise.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
