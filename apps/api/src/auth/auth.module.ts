import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/** Bare digits mean seconds (jsonwebtoken would read the string "3600" as milliseconds). */
function parseExpiresIn(v: string | undefined): JwtSignOptions['expiresIn'] {
  if (!v) return '8h';
  return /^[0-9]+$/.test(v) ? Number(v) : (v as JwtSignOptions['expiresIn']);
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: parseExpiresIn(config.get<string>('JWT_EXPIRES_IN')),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
