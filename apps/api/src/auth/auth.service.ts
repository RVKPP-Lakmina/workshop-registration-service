import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPublicUser } from '../users/users.service.js';

// Compared against when the email is unknown so response time doesn't leak it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return { token, user: toPublicUser(user) };
  }
}
