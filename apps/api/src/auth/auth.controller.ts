import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Public, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { Role } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';
import { sessionCookieName, sessionCookieOptions } from './session-cookie.js';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Sets the session as an HttpOnly cookie; the token is never returned in the body. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    const exp = this.jwt.decode<{ exp?: number } | null>(token)?.exp;
    res.cookie(sessionCookieName(this.config), token, {
      ...sessionCookieOptions(this.config),
      ...(exp ? { maxAge: Math.max(0, exp * 1000 - Date.now()) } : {}),
    });
    return { user };
  }

  /** Public so it also works when the session has already expired. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(sessionCookieName(this.config), sessionCookieOptions(this.config));
  }

  @Get('me')
  @Roles(Role.ADMIN, Role.MANAGER, Role.STAFF)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
