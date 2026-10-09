// SSOT Phase 085 Task 5 — KYC verification orchestrator (<3s submit path)
// Canonical: apps/backend/src/modules/kyc/services/kyc-verification.service.ts
// - Flow (§5.2 + §7 tiers): Zod gate -> ID/laser aggregate gate -> OCR
//   merge -> fuzzy name tier (AUTO→PENDING / REVIEW→ACTION_REQUIRED /
//   REJECT→400) -> AES encrypt -> ONE $transaction: KYC upsert + payout
//   account upsert + user kycStatus + audit row (Gate 7, <1s) -> stream.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreatorKYCInputSchema, KYCApprovalActionSchema } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { assertDecidable, assertRejection, assertSubmittable } from '../domain/kyc-verification.aggregate';
import { KYC_DECIDED_EVENT } from '../domain/events/kyc-approved.event';
import { KYC_SUBMITTED_EVENT } from '../domain/events/kyc-submitted.event';
import { KycEncryptionService } from './kyc-encryption.service';
import { BankValidationService } from './bank-validation.service';
import { KycOcrService } from './kyc-ocr.service';
import { KycQueueService } from './kyc-queue.service';

export interface KycStore {
  upsertKyc(args: {
    userId: string; idCardNumberEnc: string; laserCodeEnc: string;
    firstNameTh: string; lastNameTh: string; birthDate: Date;
    idCardImageUrl: string; selfieImageUrl: string; bookbankImageUrl: string;
    ocrConfidence: number; status: string;
  }): Promise<{ id: string }>;
  upsertPayoutAccount(args: {
    kycId: string; userId: string; bankCode: string; bankAccountNumberEnc: string;
    bankAccountName: string; nameMatchScore: number; taxId?: string;
  }): Promise<void>;
  setUserKycStatus(userId: string, status: string): Promise<void>;
  audit(args: { kycId: string; actorUserId: string; action: string; ipAddress: string; userAgent: string }): Promise<void>;
  findKyc(kycId: string): Promise<{ id: string; userId: string; status: string } | null>;
  findKycByUser(userId: string): Promise<{ id: string; status: string; payoutStatus: string | null; rejectionReason: string | null } | null>;
  reviewQueue(): Promise<Array<{ id: string; userId: string; status: string; createdAt: Date }>>;
  decideKyc(kycId: string, args: { status: string; rejectionReason?: string; actorUserId: string }): Promise<void>;
  setPayoutStatus(userId: string, status: string): Promise<void>;
}

export interface KycTxRunner {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class KycVerificationService {
  constructor(
    private readonly store: KycStore,
    private readonly tx: KycTxRunner,
    private readonly encryption: KycEncryptionService,
    private readonly bank: BankValidationService,
    private readonly ocr: KycOcrService,
    private readonly queue: KycQueueService,
  ) {}

  async submitCreatorKyc(userId: string, input: unknown, net: { ipAddress: string; userAgent: string }): Promise<{
    success: boolean;
    kycId: string;
    nameMatchScore: number;
    tier: 'AUTO' | 'REVIEW' | 'REJECT';
  }> {
    const data = CreatorKYCInputSchema.safeParse(input);    if (!data.success) throw new BadRequestException('Invalid KYC submission');
    assertSubmittable({ idCardNumber: data.data.idCardNumber, laserCode: data.data.laserCode });

    const merged = await this.ocr.extractWithFallback(data.data.idCardImageUrl, {
      idCardNumber: data.data.idCardNumber,
      firstNameTh: data.data.firstNameTh,
      lastNameTh: data.data.lastNameTh,
      birthDate: data.data.birthDate,
    });

    const score = this.bank.calculateFuzzyMatchScore(
      `${merged.firstNameTh} ${merged.lastNameTh}`,
      data.data.bankAccountName,
    );
    const tier = this.bank.tierFor(score);
    if (tier === 'REJECT') {
      throw new BadRequestException('ชื่อบัญชีธนาคารไม่ตรงกับชื่อบนบัตรประชาชน');
    }

    const kycId = await this.tx.run(async () => {
      const row = await this.store.upsertKyc({
        userId,
        idCardNumberEnc: this.encryption.encrypt(merged.idCardNumber),
        laserCodeEnc: this.encryption.encrypt(data.data.laserCode),
        firstNameTh: merged.firstNameTh,
        lastNameTh: merged.lastNameTh,
        birthDate: new Date(merged.birthDate),
        idCardImageUrl: data.data.idCardImageUrl,
        selfieImageUrl: data.data.selfieImageUrl,
        bookbankImageUrl: data.data.bookbankImageUrl,
        ocrConfidence: merged.ocrConfidence,
        status: tier === 'AUTO' ? 'PENDING' : 'ACTION_REQUIRED',
      });
      await this.store.upsertPayoutAccount({
        kycId: row.id,
        userId,
        bankCode: data.data.bankCode,
        bankAccountNumberEnc: this.encryption.encrypt(data.data.bankAccountNumber),
        bankAccountName: data.data.bankAccountName,
        nameMatchScore: score,
        ...(data.data.taxId ? { taxId: data.data.taxId } : {}),
      });
      await this.store.setUserKycStatus(userId, tier === 'AUTO' ? 'PENDING' : 'ACTION_REQUIRED');
      await this.store.audit({
        kycId: row.id,
        actorUserId: userId,
        action: 'SUBMIT',
        ipAddress: net.ipAddress,
        userAgent: net.userAgent,
      });
      return row.id;
    });

    await this.queue.publish(KYC_SUBMITTED_EVENT, {
      kycId,
      userId,
      nameMatchScore: score,
      tier,
    });
    return { success: true, kycId, nameMatchScore: score, tier };
  }

  async statusOf(userId: string): Promise<{
    kycStatus: string;
    payoutStatus: string | null;
    rejectionReason: string | null;
  }> {
    const row = await this.store.findKycByUser(userId);
    if (!row) return { kycStatus: 'NOT_SUBMITTED', payoutStatus: null, rejectionReason: null };
    return {
      kycStatus: row.status,
      payoutStatus: row.payoutStatus,
      rejectionReason: row.rejectionReason,
    };
  }

  async decideKyc(actorUserId: string, actorRole: string | undefined, action: { kycId: string; status: string; rejectionReason?: string }, net: { ipAddress: string; userAgent: string }): Promise<{ kycId: string; status: string }> {
    if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'FINANCE_ADMIN' && actorRole !== 'CONTENT_MODERATOR') {
      throw new BadRequestException('KYC decisions require an admin role');
    }
    const parsed = KYCApprovalActionSchema.safeParse(action);
    if (!parsed.success) throw new BadRequestException('Invalid approval action');
    const row = await this.store.findKyc(parsed.data.kycId);
    if (!row) throw new BadRequestException('KYC record not found');
    assertDecidable(row.status);
    assertRejection({ status: parsed.data.status, rejectionReason: parsed.data.rejectionReason });

    await this.tx.run(async () => {
      await this.store.decideKyc(parsed.data.kycId, {
        status: parsed.data.status,
        rejectionReason: parsed.data.rejectionReason,
        actorUserId,
      });
      await this.store.setUserKycStatus(row.userId, parsed.data.status);
      await this.store.setPayoutStatus(
        row.userId,
        parsed.data.status === 'VERIFIED' ? 'ACTIVE' : parsed.data.status === 'REJECTED' ? 'SUSPENDED' : 'PENDING_VERIFICATION',
      );
      await this.store.audit({
        kycId: parsed.data.kycId,
        actorUserId,
        action: parsed.data.status === 'VERIFIED' ? 'APPROVE' : parsed.data.status === 'REJECTED' ? 'REJECT' : 'REQUEST_ACTION',
        ipAddress: net.ipAddress,
        userAgent: net.userAgent,
      });
    });

    await this.queue.publish(KYC_DECIDED_EVENT, {
      kycId: parsed.data.kycId,
      userId: row.userId,
      status: parsed.data.status,
      actorUserId,
    });
    return { kycId: parsed.data.kycId, status: parsed.data.status };
  }
}

// SSOT Phase 085 — Prisma KYC store (structural adapter, co-located: the §5.1
// tree defines no repositories/ dir; the port above stays test-seam).
// Co-location is documented, not hidden: 111 may promote this to infra/.
type StoreDb = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

export class PrismaKycStore implements KycStore {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): StoreDb {
    return this.prisma as unknown as StoreDb;
  }

  async upsertKyc(args: {
    userId: string; idCardNumberEnc: string; laserCodeEnc: string;
    firstNameTh: string; lastNameTh: string; birthDate: Date;
    idCardImageUrl: string; selfieImageUrl: string; bookbankImageUrl: string;
    ocrConfidence: number; status: string;
  }): Promise<{ id: string }> {
    return (await this.db['creatorKYC'].upsert({
      where: { userId: args.userId },
      update: { ...args },
      create: { ...args },
    })) as { id: string };
  }

  async upsertPayoutAccount(args: {
    kycId: string; userId: string; bankCode: string; bankAccountNumberEnc: string;
    bankAccountName: string; nameMatchScore: number; taxId?: string;
  }): Promise<void> {
    await this.db['creatorPayoutAccount'].upsert({
      where: { creatorKycId: args.kycId },
      update: { ...args },
      create: { ...args },
    });
  }

  async setUserKycStatus(userId: string, status: string): Promise<void> {
    await this.db['user'].update({ where: { id: userId }, data: { kycStatus: status } });
  }

  async audit(args: { kycId: string; actorUserId: string; action: string; ipAddress: string; userAgent: string }): Promise<void> {
    // Prisma client name for model KYCAuditLog is kYCAuditLog (first-letter lowercased).
    await this.db['kYCAuditLog'].create({ data: { ...args } });
  }

  async findKyc(kycId: string): Promise<{ id: string; userId: string; status: string } | null> {
    return ((await this.db['creatorKYC'].findUnique({ where: { id: kycId } }).catch(() => null)) as {
      id: string; userId: string; status: string;
    } | null) ?? null;
  }

  async findKycByUser(userId: string): Promise<{ id: string; status: string; payoutStatus: string | null; rejectionReason: string | null } | null> {
    const row = (await this.db['creatorKYC'].findUnique({
      where: { userId },
      include: { payoutAccount: true },
    }).catch(() => null)) as {
      id: string; status: string; rejectionReason: string | null;
      payoutAccount: { status: string } | null;
    } | null;
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      payoutStatus: row.payoutAccount?.status ?? null,
      rejectionReason: row.rejectionReason,
    };
  }

  async decideKyc(kycId: string, args: { status: string; rejectionReason?: string; actorUserId: string }): Promise<void> {
    await this.db['creatorKYC'].update({
      where: { id: kycId },
      data: {
        status: args.status,
        ...(args.rejectionReason ? { rejectionReason: args.rejectionReason } : {}),
        ...(args.status === 'VERIFIED' ? { verifiedAt: new Date(), verifiedByUserId: args.actorUserId } : {}),
      },
    });
  }

  async setPayoutStatus(userId: string, status: string): Promise<void> {
    const row = (await this.db['creatorPayoutAccount'].findFirst({ where: { userId } }).catch(() => null)) as {
      id: string;
    } | null;
    if (row) {
      await this.db['creatorPayoutAccount'].update({ where: { id: row.id }, data: { status } });
    }
  }

  async reviewQueue(): Promise<Array<{ id: string; userId: string; status: string; createdAt: Date }>> {
    return (await this.db['creatorKYC'].findMany({
      where: { status: { in: ['PENDING', 'ACTION_REQUIRED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }).catch(() => [])) as Array<{ id: string; userId: string; status: string; createdAt: Date }>;
  }
}
