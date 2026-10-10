// SSOT Phase 112 Tasks 2/5 §5.2 — moderation orchestrator engine
// Canonical: apps/backend/src/modules/moderation/services/moderation-engine.service.ts
// (legacy src/backend/modules/moderation/.../moderation-engine.service.ts)
// - Flow (§1.3 BDD <1.5s): SCANNING ledger row -> parallel NSFW + copyright
//   scans -> severity ladder -> ONE $transaction: result ledger row +
//   product.isPublished flip (+ fingerprint upsert on PASSED) (Gate 7) ->
//   Flex notify (fail-open) + stream event with elapsedMs (Gate 8).
// - Ledger is append-only: status reads resolve the latest row per product.
// - Quarantine never deletes R2 source bytes (OUT_OF_SCOPE_STRICT) —
//   visibility flips only. Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { MODERATION_EVENT_STREAM, MOD_RESCAN_LIMIT, MOD_RESCAN_WINDOW_SEC, rescanRateKey, severityFor } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { NsfwDetectorService } from './nsfw-detector.service';
import { CopyrightScannerService } from './copyright-scanner.service';
import { ModerationNotificationService } from './moderation-notify.service';
import { buildModerationFlex, moderationFlexByteSize, MOD_FLEX_BUDGET_BYTES } from './moderation-flex.builder';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

export interface ScanInputs {
  contentType?: string;
  frames?: Array<{ key: string; nsfwScore?: number }>;
  binaryDigests?: Array<{ digest: string; location: string }>;
}

export interface ModerationVerdict {
  productId: string;
  status: string;
  confidenceScore: number;
  flaggedCategories: string[];
  violatingLocations: string[];
  severity: string;
  elapsedMs: number;
}

type PrismaAny = {
  product: { findUnique(a: unknown): Promise<unknown>; update(a: unknown): Promise<unknown> };
  user: { findUnique(a: unknown): Promise<unknown> };
  contentModerationLog: { findFirst(a: unknown): Promise<unknown>; findMany(a: unknown): Promise<unknown[]>; count(a: unknown): Promise<number>; create(a: unknown): Promise<unknown> };
  copyrightFingerprint: { findMany(a: unknown): Promise<unknown[]>; upsert(a: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type TxAny = {
  contentModerationLog: { create(a: unknown): Promise<unknown> };
  product: { update(a: unknown): Promise<unknown> };
  copyrightFingerprint: { upsert(a: unknown): Promise<unknown> };
};

@Injectable()
export class ModerationEngineService {
  private readonly logger = new Logger(ModerationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly nsfw: NsfwDetectorService,
    private readonly copyright: CopyrightScannerService,
    private readonly notify: ModerationNotificationService,
  ) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  private assertAdmin(role: string | undefined): void {
    if (!role || !ADMIN_ROLES.has(role)) throw new ForbiddenException('Moderation review requires an admin role');
  }

  async latestLog(productId: string): Promise<Record<string, unknown> | null> {
    const row = (await this.db.contentModerationLog.findFirst({
      where: { productId },
      orderBy: { scannedAt: 'desc' },
    }).catch(() => null)) as Record<string, unknown> | null;
    return row;
  }

  /** Full multi-modal scan with atomic quarantine/publish (BDD-1 <1.5s). */
  async processContentModeration(productId: string, inputs?: ScanInputs, tenantName = 'default'): Promise<ModerationVerdict> {
    if (!productId) throw new BadRequestException('Missing productId');
    const startedAt = Date.now();
    const product = (await this.db.product.findUnique({ where: { id: productId } }).catch(() => null)) as {
      id: string; sellerId: string; title: string; description: string; productType: string;
    } | null;
    if (!product) throw new BadRequestException('Product not found for moderation scan');

    await this.db.contentModerationLog.create({
      data: { productId, status: 'SCANNING', confidenceScore: 0, severity: 'LOW', flaggedCategories: [], violatingPages: [] },
    }).catch(() => undefined);

    const fingerprints = (await this.db.copyrightFingerprint.findMany({
      select: { id: true, perceptualHash: true, textEmbeddingHash: true },
      take: 500,
    }).catch(() => [])) as Array<{ id: string; perceptualHash: string; textEmbeddingHash: string | null }>;

    const textSamples = [
      { text: product.title ?? '', location: 'title' },
      { text: product.description ?? '', location: 'description' },
    ];
    const [nsfwResult, copyrightResult] = await Promise.all([
      this.nsfw.scanProductContent({ title: product.title ?? '', description: product.description ?? '' }, { frames: inputs?.frames }),
      this.copyright.scanCopyrightMatch({ textSamples, binaryDigests: inputs?.binaryDigests }, fingerprints),
    ]);

    const flaggedCategories = [
      ...nsfwResult.categories,
      ...(copyrightResult.isMatched ? ['COPYRIGHT_VIOLATION'] : []),
    ];
    const profanityOnly = nsfwResult.isFlagged && !nsfwResult.categories.includes('NUDITY_EXPLICIT') && !copyrightResult.isMatched;
    let finalStatus = 'PASSED';
    if (copyrightResult.isMatched) {
      finalStatus = 'FLAGGED_COPYRIGHT';
    } else if (nsfwResult.isFlagged) {
      finalStatus = profanityOnly ? 'FLAGGED_PROFANITY' : 'FLAGGED_NSFW';
    }
    const severity = severityFor({ nsfwFlagged: nsfwResult.isFlagged, copyrightMatched: copyrightResult.isMatched });
    const confidenceScore = Math.max(nsfwResult.score, copyrightResult.score);
    const quarantined = finalStatus !== 'PASSED';
    const storedStatus = quarantined ? 'QUARANTINED' : 'PASSED';

    await this.db.$transaction(async (txu: unknown) => {
      const tx = txu as unknown as TxAny;
      await tx.contentModerationLog.create({
        data: {
          productId,
          status: storedStatus,
          confidenceScore,
          severity,
          flaggedCategories,
          violatingPages: [...nsfwResult.violatingLocations, ...copyrightResult.violatingLocations],
          aiAnalysisJson: {
            contentType: inputs?.contentType ?? product.productType,
            nsfw: { score: nsfwResult.score, locations: nsfwResult.violatingLocations, explanation: nsfwResult.aiExplanation ?? null },
            copyright: { score: copyrightResult.score, locations: copyrightResult.violatingLocations, matchedFingerprintId: copyrightResult.matchedFingerprintId ?? null },
          },
        },
      });
      await tx.product.update({ where: { id: productId }, data: { isPublished: !quarantined } });
      if (!quarantined) {
        const fp = this.copyright.fingerprintFor(productId, { textSeed: `${product.title ?? ''} ${product.description ?? ''}` });
        await tx.copyrightFingerprint.upsert({
          where: { productId },
          update: { perceptualHash: fp.perceptualHash, textEmbeddingHash: fp.textEmbeddingHash },
          create: fp,
        });
      }
    });

    const elapsedMs = Date.now() - startedAt;
    const seller = (await this.db.user.findUnique({ where: { id: product.sellerId } }).catch(() => null)) as { lineUserId?: string | null } | null;
    const bubble = buildModerationFlex({
      outcome: quarantined ? 'QUARANTINED' : 'PASSED',
      productTitle: product.title ?? productId,
      tenantName,
      detail: quarantined ? `หมวด: ${flaggedCategories.join(', ') || '—'}` : undefined,
    });
    if (moderationFlexByteSize(bubble) <= MOD_FLEX_BUDGET_BYTES) {
      try {
        await this.notify.notify(seller?.lineUserId ?? null, quarantined ? 'QUARANTINED' : 'PASSED', JSON.stringify(bubble));
      } catch {
        // Notify is fail-open — the verdict transaction already committed.
      }
    }
    try {
      await this.redis.xaddPipeline(MODERATION_EVENT_STREAM, [{
        event: quarantined ? 'moderation.quarantined' : 'moderation.passed',
        productId, status: storedStatus, elapsedMs, at: Date.now(),
      }]);
    } catch {
      // Telemetry never breaks moderation flows.
    }
    if (elapsedMs > 1500) {
      this.logger.warn(`Moderation SLA breach for ${productId}: ${elapsedMs}ms`);
    }
    return {
      productId,
      status: storedStatus,
      confidenceScore,
      flaggedCategories,
      violatingLocations: [...nsfwResult.violatingLocations, ...copyrightResult.violatingLocations],
      severity,
      elapsedMs,
    };
  }

  /** Rate-shielded manual rescan (5 per product per 10 min, fail-open). */
  async triggerRescan(productId: string, tenantName = 'default'): Promise<ModerationVerdict> {
    try {
      const key = rescanRateKey(productId);
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, MOD_RESCAN_WINDOW_SEC);
      if (count > MOD_RESCAN_LIMIT) throw new BadRequestException('Rescan rate limit exceeded (5 per 10 minutes)');
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Fail-open: Redis outage never blocks safety rescans.
    }
    return this.processContentModeration(productId, undefined, tenantName);
  }

  /** Creator/admin status read (ownership-checked for non-admins). */
  async getStatus(productId: string, actor: { id: string; role: string | undefined }): Promise<Record<string, unknown>> {
    const product = (await this.db.product.findUnique({ where: { id: productId } }).catch(() => null)) as { sellerId: string } | null;
    if (!product) throw new BadRequestException('Product not found');
    if ((!actor.role || !ADMIN_ROLES.has(actor.role)) && product.sellerId !== actor.id) {
      throw new ForbiddenException('Not your product');
    }
    const log = await this.latestLog(productId);
    if (!log) {
      return { id: null, productId, status: 'PENDING_SCAN', confidenceScore: 0, flaggedCategories: [], violatingLocations: [], aiAnalysisSummary: null, scannedAt: null };
    }
    return {
      id: log['id'],
      productId,
      status: log['status'],
      confidenceScore: Number(log['confidenceScore'] ?? 0),
      flaggedCategories: log['flaggedCategories'] ?? [],
      violatingLocations: log['violatingPages'] ?? [],
      aiAnalysisSummary: (log['aiAnalysisJson'] as { nsfw?: { explanation?: string } } | null)?.nsfw?.explanation ?? null,
      scannedAt: log['scannedAt'] instanceof Date ? (log['scannedAt'] as Date).toISOString() : String(log['scannedAt'] ?? ''),
    };
  }

  /** Paginated admin queue over latest-flagged products (masked summary). */
  async getQueue(actorRole: string | undefined, args: { status?: string; page?: number; limit?: number }): Promise<{ items: Record<string, unknown>[]; totalCount: number; quarantinedCount: number; appealPendingCount: number }> {
    this.assertAdmin(actorRole);
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    const where: Record<string, unknown> = args.status ? { status: args.status } : { status: { in: ['QUARANTINED', 'FLAGGED_NSFW', 'FLAGGED_COPYRIGHT', 'FLAGGED_PROFANITY', 'APPEAL_PENDING'] } };
    const [rows, totalCount, quarantinedCount, appealPendingCount] = await Promise.all([
      this.db.contentModerationLog.findMany({ where, orderBy: { scannedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.db.contentModerationLog.count({ where }),
      this.db.contentModerationLog.count({ where: { status: 'QUARANTINED' } }),
      this.db.contentModerationLog.count({ where: { status: 'APPEAL_PENDING' } }),
    ]);
    return { items: rows as Record<string, unknown>[], totalCount, quarantinedCount, appealPendingCount };
  }
}
