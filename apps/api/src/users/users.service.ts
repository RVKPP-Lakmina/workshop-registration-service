import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { writeAudit } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Prisma, Role } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const toPublicUser = (user: User): Omit<User, 'passwordHash'> => {
  const { passwordHash: _hash, ...rest } = user;
  return rest;
};

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map(toPublicUser);
  }

  async create(actorId: string, input: CreateUserInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email.trim().toLowerCase(),
            name: input.name.trim(),
            role: input.role,
            passwordHash: await bcrypt.hash(input.password, 10),
          },
        });
        await writeAudit(tx, {
          actorId,
          action: 'USER_CREATED',
          entityType: 'USER',
          entityId: user.id,
          after: toPublicUser(user),
        });
        return toPublicUser(user);
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email already exists');
      }
      throw e;
    }
  }

  async update(actorId: string, id: string, input: UpdateUserInput) {
    const passwordHash = input.password
      ? await bcrypt.hash(input.password, 10)
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

      if (
        id === actorId &&
        ((input.role !== undefined && input.role !== before.role) ||
          input.isActive === false)
      ) {
        throw new AppError(
          400,
          'CANNOT_MODIFY_SELF',
          'You cannot change your own role or deactivate yourself',
        );
      }

      const data: Prisma.UserUpdateInput = {
        name: input.name?.trim(),
        role: input.role,
        isActive: input.isActive,
        passwordHash,
      };
      const after = await tx.user.update({ where: { id }, data });

      const action =
        input.role !== undefined && input.role !== before.role
          ? 'USER_ROLE_CHANGED'
          : input.isActive !== undefined && input.isActive !== before.isActive
            ? input.isActive
              ? 'USER_ACTIVATED'
              : 'USER_DEACTIVATED'
            : input.password
              ? 'USER_PASSWORD_RESET'
              : 'USER_UPDATED';
      await writeAudit(tx, {
        actorId,
        action,
        entityType: 'USER',
        entityId: id,
        before: toPublicUser(before),
        after: toPublicUser(after),
      });
      return toPublicUser(after);
    });
  }
}
