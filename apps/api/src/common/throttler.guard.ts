import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Authenticated callers are limited per user (the front desk shares one office
// IP); logins are limited per IP + email; everything else per IP.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.id) return Promise.resolve(`user:${req.user.id}`);
    const ip = req.ip ?? 'unknown';
    if (req.originalUrl?.split('?')[0].endsWith('/auth/login')) {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      return Promise.resolve(`login:${ip}:${email}`);
    }
    return Promise.resolve(`ip:${ip}`);
  }
}
