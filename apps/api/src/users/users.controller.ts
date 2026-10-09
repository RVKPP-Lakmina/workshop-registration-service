import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { Role } from '../generated/prisma/client.js';
import { UsersService } from './users.service.js';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsEnum(Role) role: Role;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
}

@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(actor.id, id, dto);
  }
}
