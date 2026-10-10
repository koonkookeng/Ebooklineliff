// SSOT Phase 113 Task 5 §7 — dispute ↔ logistics bridge webhook
// Canonical: apps/backend/src/api/webhooks/dispute-logistics.controller.ts
// (legacy src/backend/api/webhooks/dispute-logistics.controller.ts)
// - HMAC-SHA256 guarded (x-dispute-signature, timing-safe;
//   DISPUTE_WEBHOOK_SECRET env-first). Fail-closed 401.
// - Carrier delivery events annotate open disputes: DELIVERED appends a
//   SYSTEM timeline row (proof-of-delivery vs buyer's NOT_RECEIVED claim);
//   LOST/DAMAGED appends a SYSTEM row flagging seller-fault evidence.
//   Never mutates verdicts — arbitration stays human/admin-owned.
// - Zero new deps.
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { DISPUTE_EVENT_STREAM } from '@repo/shared';

function verifyDisputeSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env['DISPUTE_WEBHOOK_SECRET'] ?? '';
  if (!signature || !secret) throw new UnauthorizedException('Missing dispute webhook signature');
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== computed.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedException('Invalid dispute webhook signature');
  }
}

type PrismaAny = {
  disputeClaim: { findFirst(a: unknown): Promise<unknown> };
  disputeTimeline: { create(a: unknown): Promise<unknown> };
};

const TERMINAL_CARRIER = new Set(['DELIVERED', 'LOST', 'DAMAGED']);

@Controller('api/webhooks/dispute-logistics')
export class DisputeLogisticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  @Post('carrier-event')
  async carrierEvent(@Body() body: unknown, @Headers('x-dispute-signature') signature: string | undefined) {
    verifyDisputeSignature(JSON.stringify(body), signature);
    const b = (body ?? {}) as { orderId?: string; carrierStatus?: string; trackingNumber?: string };
    if (!b.orderId || !b.carrierStatus) throw new BadRequestException('Missing orderId/carrierStatus');
    if (!TERMINAL_CARRIER.has(b.carrierStatus)) return { noted: false };

    const db = this.prisma as unknown as PrismaAny;
    const dispute = (await db.disputeClaim.findFirst({ where: { orderId: b.orderId } }).catch(() => null)) as {
      id: string; status: string;
    } | null;
    if (!dispute) return { noted: false };
    const note = b.carrierStatus === 'DELIVERED'
      ? `Carrier proof-of-delivery ${b.trackingNumber ?? ''} vs open dispute`
      : `Carrier reports ${b.carrierStatus} ${b.trackingNumber ?? ''} — seller-fault evidence`;
    await db.disputeTimeline.create({
      data: { disputeId: dispute.id, actorRole: 'SYSTEM', actionState: `CARRIER_${b.carrierStatus}`, note },
    }).catch(() => undefined);
    try {
      await this.redis.xaddPipeline(DISPUTE_EVENT_STREAM, [{
        event: 'dispute.carrier.evidence', disputeId: dispute.id, orderId: b.orderId, carrierStatus: b.carrierStatus, at: Date.now(),
      }]);
    } catch {
      // Telemetry never breaks webhook intake.
    }
    return { noted: true, disputeId: dispute.id };
  }
}
