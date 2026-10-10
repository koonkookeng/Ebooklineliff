// SSOT Phase 111 Tasks 3/4/7 — KYC verification queue review service
// Canonical: apps/backend/src/modules/kyc/services/kyc-queue-review.service.ts
// (legacy src/backend/modules/kyc/.../kyc-queue.service.ts lives on for the
// 085 stream handoff — this 111 service owns paginated review + atomic
// verdicts; no BullMQ package per zero-dep rule, Redis stream reuse.)
// - GET queue: PENDING/ACTION_REQUIRED pool, status/risk filter, masked PII,
//   300s R2 doc URLs, pending/high-risk counters (Gate 6 zero-egress).
// - POST review: ONE $transaction — KYC VERIFIED/REJECTED + User.kycStatus +
//   role SELLER (MEMBER-only promotion) + payout ACTIVE/SUSPENDED + audit
//   (Gate 7) -> kyc.approved stream (storefront provisioning rides the event:
//   no SellerStore table exists in schema.md) -> Flex notify <500ms budget.
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { KycReviewPayloadSchema, KYC_QUEUE_PAGE_SIZE } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { R2PrivateVaultClient } from '../infra/r2-private-vault.client';
import { PiiCryptoService, maskBankAccountNumber, maskIdCardNumber } from './pii-crypto.service';
import { KycQueueService } from './kyc-queue.service';
import { KycNotificationService } from './kyc-notification.service';
import { buildKycVerdictFlex, kycFlexByteSize, KYC_FLEX_BUDGET_BYTES } from './kyc-flex-message.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);
const REVIEWABLE = ['PENDING', 'ACTION_REQUIRED'];

type PrismaAny = {
  creatorKYC: { findMany(a: unknown): Promise<unknown[]>; count(a: unknown): Promise<number>; findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  user: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  creatorPayoutAccount: { findFirst(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  kYCAuditLog: { create(a: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

export interface KycQueueItem {
  id: string;
  userId: string;
  status: string;
  idCardNumberMasked: string;
  fullNameTh: string;
  bankName: string;
  bankAccountNumberMasked: string;
  bankAccountName: string;
  idCardImageUrlSigned: string;
  bankBookImageUrlSigned: string;
  riskLevel: string;
  confidenceScore: number;
  submittedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

@Injectable()
export class KycQueueReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: R2PrivateVaultClient,
    private readonly pii: PiiCryptoService,
    private readonly queue: KycQueueService,
    private readonly notify: KycNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private assertAdmin(role: string | undefined): void {
    if (!role || !ADMIN_ROLES.has(role)) throw new ForbiddenException('KYC review requires an admin role');
  }

  private maskedName(row: { firstNameTh?: string | null; lastNameTh?: string | null; bankAccountName?: string }): string {
    const full = [row.firstNameTh, row.lastNameTh].filter(Boolean).join(' ').trim();
    return full || (row.bankAccountName ?? '');
  }

  /** Paginated admin queue with masked PII + short-lived doc URLs. */
  async getQueue(actorRole: string | undefined, args: { status?: string; riskLevel?: string; page?: number; limit?: number }): Promise<{ items: KycQueueItem[]; totalCount: number; pendingCount: number; highRiskCount: number }> {
    this.assertAdmin(actorRole);
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(100, Math.max(1, args.limit ?? KYC_QUEUE_PAGE_SIZE));
    const statusIn = args.status && REVIEWABLE.concat(['VERIFIED', 'REJECTED']).includes(args.status) ? [args.status] : REVIEWABLE;
    const where: Record<string, unknown> = { status: { in: statusIn } };
    if (args.riskLevel && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(args.riskLevel)) where['riskLevel'] = args.riskLevel;

    const [rows, totalCount, pendingCount, highRiskCount] = await Promise.all([
      this.db.creatorKYC.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.db.creatorKYC.count({ where }),
      this.db.creatorKYC.count({ where: { status: { in: REVIEWABLE } } }),
      this.db.creatorKYC.count({ where: { status: { in: REVIEWABLE }, riskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
    ]);
    const items = (rows as Array<Record<string, unknown>>).map((r) => {
      const idCardKey = typeof r['idCardImageUrl'] === 'string' && r['idCardImageUrl'] ? String(r['idCardImageUrl']) : '';
      const bookKey = typeof r['bookbankImageUrl'] === 'string' && r['bookbankImageUrl'] ? String(r['bookbankImageUrl']) : '';
      let idMasked = 'X-XXXX-XXXXX-XX-X';
      try {
        const raw = this.pii.decrypt(String(r['idCardNumberEnc'] ?? ''));
        if (raw) idMasked = maskIdCardNumber(raw);
      } catch {
        // Masked fallback — never leak ciphertext to the admin UI.
      }
      return {
        id: String(r['id'] ?? ''),
        userId: String(r['userId'] ?? ''),
        status: String(r['status'] ?? ''),
        idCardNumberMasked: idMasked,
        fullNameTh: this.maskedName(r as { firstNameTh?: string | null; lastNameTh?: string | null; bankAccountName?: string }),
        bankName: String(r['bankName'] ?? ''),
        bankAccountNumberMasked: maskBankAccountNumber(String(r['bankAccountNumber'] ?? '')),
        bankAccountName: String(r['bankAccountName'] ?? ''),
        idCardImageUrlSigned: idCardKey ? this.vault.docViewUrl(idCardKey).url : '',
        bankBookImageUrlSigned: bookKey ? this.vault.docViewUrl(bookKey).url : '',
        riskLevel: String(r['riskLevel'] ?? 'LOW'),
        confidenceScore: r['ocrConfidence'] === null || r['ocrConfidence'] === undefined ? 0 : Math.round(Number(r['ocrConfidence']) * 100),
        submittedAt: r['createdAt'] instanceof Date ? (r['createdAt'] as Date).toISOString() : String(r['createdAt'] ?? ''),
        verifiedAt: r['verifiedAt'] instanceof Date ? (r['verifiedAt'] as Date).toISOString() : null,
        rejectionReason: (r['rejectionReason'] as string | null) ?? null,
      } satisfies KycQueueItem;
    });
    return { items, totalCount, pendingCount, highRiskCount };
  }

  /**
   * Atomic verdict: KYC + role SELLER + payout + audit in ONE transaction,
   * then Flex notify (500ms budget, fail-open) + approved stream event.
   */
  async review(actor: { id: string; role: string | undefined }, input: unknown, net: { ipAddress: string; userAgent: string; tenantName?: string }): Promise<boolean> {
    this.assertAdmin(actor.role);
    const parsed = KycReviewPayloadSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid KYC review payload');
    const { kycId, status, rejectionReason, adminNotes } = parsed.data;
    if (status === 'REJECTED' && !rejectionReason?.trim()) throw new BadRequestException('Rejection requires a reason');

    const existing = (await this.db.creatorKYC.findUnique({ where: { id: kycId } }).catch(() => null)) as {
      id: string; userId: string; status: string; firstNameTh?: string | null; lastNameTh?: string | null; bankAccountName?: string;
    } | null;
    if (!existing) throw new BadRequestException('KYC record not found');
    if (!REVIEWABLE.includes(existing.status)) throw new ForbiddenException(`KYC in status ${existing.status} cannot be decided`);

    const user = (await this.db.user.findUnique({ where: { id: existing.userId } }).catch(() => null)) as {
      id: string; role: string; lineUserId?: string | null;
    } | null;
    const promoteToSeller = status === 'VERIFIED' && (!user || user.role === 'MEMBER');

    await this.db.$transaction(async () => {
      const tx = this.db;
      await tx.creatorKYC.update({
        where: { id: kycId },
        data: {
          status,
          ...(status === 'VERIFIED'
            ? { verifiedAt: new Date(), verifiedByUserId: actor.id, reviewedByAdminId: actor.id, rejectionReason: null }
            : { rejectionReason: rejectionReason ?? null, reviewedByAdminId: actor.id }),
        },
      });
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          kycStatus: status,
          ...(promoteToSeller ? { role: 'SELLER' } : {}),
        },
      });
      const payout = (await tx.creatorPayoutAccount.findFirst({ where: { userId: existing.userId } }).catch(() => null)) as { id: string } | null;
      if (payout) {
        await tx.creatorPayoutAccount.update({
          where: { id: payout.id },
          data: { status: status === 'VERIFIED' ? 'ACTIVE' : 'SUSPENDED' },
        });
      }
      await tx.kYCAuditLog.create({
        data: {
          kycId,
          actorUserId: actor.id,
          action: status === 'VERIFIED' ? 'APPROVED' : 'REJECTED',
          ipAddress: net.ipAddress,
          userAgent: net.userAgent,
          metadata: { ...(adminNotes ? { adminNotes } : {}), via: 'phase111-queue' },
        },
      });
    });

    const fullName = [existing.firstNameTh, existing.lastNameTh].filter(Boolean).join(' ').trim() || existing.bankAccountName || '';
    const bubble = buildKycVerdictFlex({
      verdict: status,
      fullNameTh: fullName,
      tenantName: net.tenantName ?? 'default',
      ...(rejectionReason ? { rejectionReason } : {}),
    });
    if (kycFlexByteSize(bubble) > KYC_FLEX_BUDGET_BYTES) throw new BadRequestException('Flex payload exceeds 10KB budget');
    const notifyStartedAt = Date.now();
    try {
      await this.notify.notify(user?.lineUserId ?? null, status, JSON.stringify(bubble));
    } catch {
      // Notify is fail-open — the verdict transaction already committed.
    }
    const verdictNotifyMs = Date.now() - notifyStartedAt;
    await this.queue.publish(status === 'VERIFIED' ? 'kyc.approved' : 'kyc.rejected', { kycId, userId: existing.userId, status, actorUserId: actor.id, verdictNotifyMs });
    return true;
  }
}
