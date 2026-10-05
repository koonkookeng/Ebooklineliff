// SSOT Phase 003 §5 — thin user repository over PrismaService
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdWithKYC(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, include: { kycDetail: true } });
  }

  upsertByLineUserId(lineUserId: string, displayName: string, avatarUrl?: string) {
    return this.prisma.user.upsert({
      where: { lineUserId },
      update: { displayName, ...(avatarUrl ? { avatarUrl } : {}) },
      create: { lineUserId, displayName, avatarUrl },
    });
  }
}
