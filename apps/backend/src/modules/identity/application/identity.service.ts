// SSOT Phase 003 §1.3 — LINE LIFF provisioning + profile/address book service
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { UserAddressSchema, type UserAddressInput } from '@repo/shared';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  // Atomic upsert on lineUserId — default MEMBER / NOT_SUBMITTED via Prisma defaults
  provisionFromLineLogin(lineUserId: string, displayName: string, avatarUrl?: string) {
    return this.prisma.user.upsert({
      where: { lineUserId },
      update: { displayName, ...(avatarUrl ? { avatarUrl } : {}) },
      create: { lineUserId, displayName, avatarUrl },
    });
  }

  getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: true, kycDetail: true },
    });
  }

  updateProfile(userId: string, data: { displayName?: string; avatarUrl?: string; phone?: string }) {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async upsertAddress(userId: string, input: UserAddressInput) {
    const validated = UserAddressSchema.parse(input);
    if (validated.isDefault) {
      await this.prisma.userAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    if (validated.id) {
      const { id, ...rest } = validated;
      return this.prisma.userAddress.update({ where: { id }, data: { ...rest, userId } });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _ignored, ...rest } = validated;
    return this.prisma.userAddress.create({ data: { ...rest, userId } });
  }

  deleteAddress(userId: string, addressId: string) {
    return this.prisma.userAddress.deleteMany({ where: { id: addressId, userId } });
  }
}
