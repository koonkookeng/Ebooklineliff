// SSOT Phase 003 §5.2 — KYC application service (atomic submit)
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { CryptoService } from '../infrastructure/encryption/crypto.service';
import { CreatorKYCSchema, type CreatorKYCInput } from '@repo/shared';

@Injectable()
export class KYCService {
  private readonly logger = new Logger(KYCService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async submitKYC(userId: string, input: CreatorKYCInput) {
    // 1. Validate input via Zod contract
    const validated = CreatorKYCSchema.parse(input);

    // 2. Check existing KYC state
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { kycDetail: true },
    });

    if (!existingUser) {
      throw new BadRequestException('ไม่พบข้อมูลผู้ใช้งาน');
    }

    if (existingUser.kycStatus === 'VERIFIED') {
      throw new BadRequestException('การยืนยันตัวตนได้รับการอนุมัติเรียบร้อยแล้ว');
    }

    // 3. Encrypt sensitive PII
    const encryptedIdCard = this.crypto.encrypt(validated.idCardNumber);

    // 4. Atomic transaction: upsert KYC + status + audit
    return await this.prisma.$transaction(async (tx) => {
      const kycRecord = await tx.creatorKYC.upsert({
        where: { userId },
        update: {
          idCardNumberEnc: encryptedIdCard,
          idCardImageUrl: validated.idCardImageUrl,
          bankName: validated.bankName,
          bankAccountNumber: validated.bankAccountNumber,
          bankAccountName: validated.bankAccountName,
          taxId: validated.taxId,
        },
        create: {
          userId,
          idCardNumberEnc: encryptedIdCard,
          idCardImageUrl: validated.idCardImageUrl,
          bankName: validated.bankName,
          bankAccountNumber: validated.bankAccountNumber,
          bankAccountName: validated.bankAccountName,
          taxId: validated.taxId,
        },
      });

      await tx.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'SUBMIT_CREATOR_KYC',
          details: { bankName: validated.bankName, timestamp: new Date().toISOString() },
          ipAddress: 'SYSTEM_INTERNAL',
        },
      });

      this.logger.log(`KYC submitted for user ${userId}`);
      return kycRecord;
    });
  }
}
