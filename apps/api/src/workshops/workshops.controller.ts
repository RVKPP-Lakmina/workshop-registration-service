import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { Role, WorkshopStatus } from '../generated/prisma/client.js';
import { WorkshopsService } from './workshops.service.js';

class ListQuery {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsEnum(WorkshopStatus) status?: WorkshopStatus;
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasSeats?: boolean;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
}

class CreateWorkshopDto {
  @IsString() @MinLength(1) @MaxLength(30) code: string;
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MinLength(1) @MaxLength(120) instructor: string;
  @IsString() @MinLength(1) @MaxLength(120) location: string;
  @Type(() => Date) @IsDate() startsAt: Date;
  @Type(() => Date) @IsDate() endsAt: Date;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) capacity: number;
}

class UpdateWorkshopDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) instructor?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) location?: string;
  @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) capacity?: number;
  @IsOptional() @IsEnum(WorkshopStatus) status?: WorkshopStatus;
}

@Controller('workshops')
export class WorkshopsController {
  constructor(private readonly workshops: WorkshopsService) {}

  @Get()
  @Roles(Role.MANAGER, Role.STAFF)
  list(@Query() q: ListQuery) {
    return this.workshops.list(q);
  }

  @Get(':id')
  @Roles(Role.MANAGER, Role.STAFF)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.workshops.get(id);
  }

  @Post()
  @Roles(Role.MANAGER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkshopDto) {
    return this.workshops.create(user.id, dto);
  }

  @Patch(':id')
  @Roles(Role.MANAGER)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopDto,
  ) {
    return this.workshops.update(user.id, id, dto);
  }
}
