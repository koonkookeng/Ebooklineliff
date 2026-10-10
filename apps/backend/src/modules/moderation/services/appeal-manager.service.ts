// SSOT Phase 112 Task 4 §4.1/BDD-2 — creator appeal workflow engine
// Canonical: apps/backend/src/modules/moderation/services/appeal-manager.service.ts
// (legacy src/backend/modules/moderation/.../appeal-manager.service.ts)
// - Submit: Zod gate -> ownership (seller only) -> product must be
//   appeal-eligible (quarantined/flagged/APPEAL_PENDING) -> upsert appeal
//   PENDING + APPEAL_PENDING ledger row (append-only) -> stream.
// - Decide (admin): appeal must be PENDING -> ONE $transaction: appeal
//   APPROVED (+publish) or REJECTED (+stay unpublished) + ledger row +
//   product.isPublished flip on approve (Gate 7) -> Flex notify fail-open.
// - Source bytes are never deleted (OUT_OF_SCOPE_STRICT). Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CreatorAppealPayloadSchema, MODERATION_EVENT_STREAM, appealEligible } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { ModerationNotificationService } from './moderation-notify.service';
import { buildModerationFlex, moderationFlexByteSize, MOD_FLEX_BUDGET_BYTES } from './moderation-flex.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

type PrismaAny = {
  product: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  user: { findUnique(a: unknown): Promise<unknown> };
  contentModerationLog: { findFirst(a: unknown): Promise<unknown> };
  creatorAppeal: { findUnique(a: unknown): Promise<unknown>; upsert(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  creatorAppeal: { upsert(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  contentModerationLog: { create(a: unknown): Promise<unknown> };
  product: { update(a: unknown): Promise<unknown> };
};

@Injectable()
export class AppealManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly notify: ModerationNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(MODERATION_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks appeal flows.
    }
  }

  /** Creator submits proof-of-authorization appeal via LINE LIFF. */
  async submitAppeal(creatorId: string, input: unknown): Promise<{ appealId: string; productId: string; status: string }> {
    const parsed = CreatorAppealPayloadSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid appeal payload');
    const { productId, appealReason, proofDocumentUrls } = parsed.data;

    const product = (await this.db.product.findUnique({ where: { id: productId } }).catch(() => null)) as {
      id: string; sellerId: string; title: string;
    } | null;
    if (!product) throw new BadRequestException('Product not found');
    if (product.sellerId !== creatorId) throw new ForbiddenException('Only the product owner may appeal');

    const log = (await this.db.contentModerationLog.findFirst({
      where: { productId },
      orderBy: { scannedAt: 'desc' },
    }).catch(() => null)) as { status: string } | null;
    if (!log || !appealEligible(log.status)) {
      throw new BadRequestException(`Product in status ${log?.status ?? 'PENDING_SCAN'} cannot be appealed`);
    }

    const row = (await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      const appeal = (await tx.creatorAppeal.upsert({
        where: { productId },
        update: { appealReason, proofDocuments: proofDocumentUrls, status: 'PENDING', reviewedBy: null, adminNotes: null, reviewedAt: null },
        create: { productId, creatorId, appealReason, proofDocuments: proofDocumentUrls, status: 'PENDING' },
      })) as { id: string };
      await tx.contentModerationLog.create({
        data: { productId, status: 'APPEAL_PENDING', confidenceScore: 0, severity: 'LOW', flaggedCategories: [], violatingPages: [], aiAnalysisJson: { appealId: appeal.id } },
      });
      return appeal;
    })) as { id: string };

    await this.publish('moderation.appeal.submitted', { appealId: row.id, productId, creatorId });
    return { appealId: row.id, productId, status: 'PENDING' };
  }

  /** Admin overrule: approve (publish globally) or reject (stay quarantined). */
  async decideAppeal(admin: { id: string; role: string | undefined }, input: { productId: string; approve: boolean; adminNotes: string }, tenantName = 'default'): Promise<boolean> {
    if (!admin.role || !ADMIN_ROLES.has(admin.role)) throw new ForbiddenException('Moderation review requires an admin role');
    if (!input.productId) throw new BadRequestException('Missing productId');
    if (!input.adminNotes?.trim()) throw new BadRequestException('Admin notes are required');

    const appeal = (await this.db.creatorAppeal.findUnique({ where: { productId: input.productId } }).catch(() => null)) as {
      id: string; creatorId: string; status: string;
    } | null;
    if (!appeal) throw new BadRequestException('No appeal found for product');
    if (appeal.status !== 'PENDING') throw new ForbiddenException(`Appeal already ${appeal.status}`);

    const product = (await this.db.product.findUnique({ where: { id: input.productId } }).catch(() => null)) as {
      id: string; title: string;
    } | null;
    if (!product) throw new BadRequestException('Product not found');

    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.creatorAppeal.update({
        where: { id: appeal.id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          reviewedBy: admin.id,
          adminNotes: input.adminNotes,
          reviewedAt: new Date(),
        },
      });
      await tx.contentModerationLog.create({
        data: {
          productId: input.productId,
          status: input.approve ? 'MANUALLY_APPROVED' : 'REJECTED',
          confidenceScore: 1,
          severity: 'LOW',
          flaggedCategories: [],
          violatingPages: [],
          aiAnalysisJson: { appealId: appeal.id, reviewedBy: admin.id, adminNotes: input.adminNotes },
        },
      });
      await tx.product.update({ where: { id: input.productId }, data: { isPublished: input.approve } });
    });

    const creator = (await this.db.user.findUnique({ where: { id: appeal.creatorId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    const bubble = buildModerationFlex({
      outcome: input.approve ? 'APPROVED' : 'REJECTED',
      productTitle: product.title ?? input.productId,
      tenantName,
      detail: input.approve ? undefined : input.adminNotes,
    });
    if (moderationFlexByteSize(bubble) <= MOD_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(creator?.lineUserId ?? null, input.approve ? 'APPROVED' : 'REJECTED', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open — the decision transaction already committed.
      }
    }
    await this.publish(input.approve ? 'moderation.appeal.approved' : 'moderation.appeal.rejected', {
      appealId: appeal.id, productId: input.productId, actorUserId: admin.id,
    });
    return true;
  }
}
