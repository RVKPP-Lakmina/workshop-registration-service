import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { Role } from '../generated/prisma/client.js';
import { RegistrationsService } from './registrations.service.js';

class RegisterDto {
  @IsString() @MinLength(1) @MaxLength(120) attendeeName: string;
  @IsEmail() attendeeEmail: string;
  @IsOptional() @IsBoolean() joinWaitlistIfFull?: boolean;
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

const WRITE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@Controller()
@Roles(Role.MANAGER, Role.STAFF)
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get('workshops/:id/registrations')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.registrations.listForWorkshop(id);
  }

  @Post('workshops/:id/registrations')
  @Throttle(WRITE_LIMIT)
  register(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterDto,
  ) {
    return this.registrations.register(user.id, id, dto);
  }

  @Post('registrations/:id/cancel')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.registrations.cancel(user.id, id, dto.reason);
  }
}
