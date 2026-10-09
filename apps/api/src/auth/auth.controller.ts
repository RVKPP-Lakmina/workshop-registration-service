import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { CurrentUser, Public, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { Role } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @Roles(Role.ADMIN, Role.MANAGER, Role.STAFF)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
