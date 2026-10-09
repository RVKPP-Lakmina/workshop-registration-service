import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Role } from '../generated/prisma/client.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
