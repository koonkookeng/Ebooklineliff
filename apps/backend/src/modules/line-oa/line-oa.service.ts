// SSOT Phase 034 Task 3/§5.3 — LINE OA service (HMAC + follow/unfollow sync)
// Canonical: apps/backend/src/modules/line-oa/line-oa.service.ts
// (legacy src/backend/modules/line-oa/line-oa.service.ts)
// - verifyLineSignature: HMAC-SHA256 over the delivery bytes with timing-safe
//   compare (<10ms, BDD Scenario 2); exported pure for unit tests (single
//   source with the webhook path — same semantics as the Phase 004 guard).
// - processWebhookEvents: follow/unfollow → user lookup by lineUserId → atomic
//   $transaction [flag flip + audit log] (Gate 7); follow additionally publishes
//   the onboarding event (Gate 8 — the Flex dispatcher consumes the channel).
//   Unknown lineUserIds (no provisioned User yet) flip zero rows and still
//   return success — LINE retries must never spiral on unmapped users.
// - Public OA config serves NO secrets (Gate 4 — basicId + prompt mode only).
// - Zero new deps: node:crypto + Prisma SSOT + RedisClusterService only.
import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  LineOAPublicConfigSchema,
  OA_EVENT_CHANNEL,
  type LineOAPublicConfig,
} from '@repo/shared';

interface OaTables {
  user: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
  };
  tenantConfig: {
    findFirst: (args: unknown) => Promise<{ tenantName: string; lineOaId: string; botPromptMode: string } | null>;
  };
}

/** Timing-safe HMAC-SHA256 check over the delivery bytes (pure, tested). */
export function verifyLineSignature(rawBody: string, signature: string, channelSecret: string): boolean {
  if (!rawBody || !signature || !channelSecret) return false;
  const computed = createHmac('SHA256', channelSecret).update(rawBody).digest('base64');
  if (signature.length !== computed.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

export interface OaWebhookEvent {
  type?: unknown;
  source?: { userId?: unknown };
}

@Injectable()
export class LineOAService {
  private readonly logger = new Logger(LineOAService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get tables(): OaTables {
    return this.prisma as unknown as OaTables;
  }

  verifySignature(rawBody: string, signature: string): boolean {
    const secret = process.env.LINE_OA_CHANNEL_SECRET ?? process.env.LINE_CHANNEL_SECRET ?? '';
    return verifyLineSignature(rawBody, signature, secret);
  }

  /** Public (secret-free) OA config for the LIFF login flow. */
  async publicConfig(tenantName: string): Promise<LineOAPublicConfig> {
    const row = await this.tables.tenantConfig
      .findFirst({ where: { tenantName } })
      .catch(() => null);
    const fallback: LineOAPublicConfig = {
      tenantId: tenantName || 'default',
      lineOaBasicId: process.env.LINE_OA_BASIC_ID ?? '@brand_official',
      botPromptMode: 'AGGRESSIVE',
    };
    if (!row) return fallback;
    const checked = LineOAPublicConfigSchema.safeParse({
      tenantId: tenantName,
      lineOaBasicId: row.lineOaId,
      botPromptMode: row.botPromptMode,
    });
    return checked.success ? checked.data : fallback;
  }

  async processWebhookEvents(events: OaWebhookEvent[]): Promise<{ processed: number }> {
    let processed = 0;
    for (const event of events ?? []) {
      if (event?.type !== 'follow' && event?.type !== 'unfollow') continue;
      const lineUserId = event?.source?.userId;
      if (typeof lineUserId !== 'string' || !lineUserId) continue;
      const isFriend = event.type === 'follow';
      const user = await this.tables.user.findUnique({ where: { lineUserId } }).catch(() => null);
      if (!user) {
        this.logger.warn(`OA ${event.type} for unmapped line user — flag flip skipped`);
        continue;
      }
      await this.flipFriendship(lineUserId, user.id, isFriend, event);
      processed++;
    }
    return { processed };
  }

  private async flipFriendship(lineUserId: string, userId: string, isFriend: boolean, event: OaWebhookEvent): Promise<void> {
    await (this.prisma as unknown as {
      $transaction: (fn: (tx: { user: { update: (a: unknown) => Promise<unknown> }; lineOAFriendshipLog: { create: (a: unknown) => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown>;
    })
      .$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { isOAFriend: isFriend, oaFriendshipUpdatedAt: new Date() },
        });
        await tx.lineOAFriendshipLog.create({
          data: { userId, eventType: isFriend ? 'FOLLOW' : 'UNFOLLOW', rawPayload: (event ?? {}) as object },
        });
      })
      .catch((err: unknown) => {
        this.logger.warn(`OA flip failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    await this.redis
      .publish(
        OA_EVENT_CHANNEL,
        JSON.stringify({ event: isFriend ? 'line_oa_follow_success' : 'line_oa_unfollow', lineUserId, userId }),
      )
      .catch(() => undefined);
    this.logger.log(`User ${lineUserId} ${isFriend ? 'followed' : 'unfollowed'} LINE OA`);
  }
}
