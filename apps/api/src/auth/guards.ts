import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/app-error.js';
import { IS_PUBLIC, ROLES } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import type { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readCookie, sessionCookieName } from './session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, bearer] = (req.headers.authorization ?? '').split(' ');
    const bearerToken = scheme === 'Bearer' && bearer ? bearer : undefined;
    // Browsers authenticate with the HttpOnly session cookie; a Bearer header stays supported for scripts and tests.
    const token =
      bearerToken ?? readCookie(req.headers.cookie, sessionCookieName(this.config));
    if (!token) throw unauthorized();

    // Cookies are sent automatically by the browser, so cookie-authenticated writes must prove they come from
    // our own JS: a custom header cannot be set by a cross-site form and forces a CORS preflight for fetch.
    if (!bearerToken && !SAFE_METHODS.has(req.method) && !req.headers['x-requested-with']) {
      throw new AppError(403, 'CSRF_REJECTED', 'Missing X-Requested-With header');
    }

    let sub: string;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token));
    } catch {
      throw unauthorized();
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || !user.isActive) throw unauthorized();

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    } satisfies AuthUser;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!roles || !user || !roles.includes(user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this action');
    }
    return true;
  }
}

const unauthorized = () =>
  new AppError(401, 'UNAUTHORIZED', 'Authentication required');
