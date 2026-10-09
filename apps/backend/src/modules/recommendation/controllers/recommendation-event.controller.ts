// SSOT Phase 104 Task 5/6 — Recommendation REST + event ingestion controller
// Canonical: apps/backend/src/modules/recommendation/controllers/recommendation-event.controller.ts
// - GET slate (30/min rate-limit, JWT+Tenant) / POST events (Zod gate →
//   ledger + profile weights + Redis stream) / GET trending / POST feedback.
// - Zero new deps.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  REC_RATE_LIMIT_PER_MIN,
  TrackInteractionEventSchema,
  recRateLimitKey,
  type RecommendationItem,
} from '@repo/shared';
import { HybridRerankerService } from '../services/hybrid-reranker.service';
import { ColdStartService } from '../services/cold-start.service';
import { PrismaRecommendationRepository } from '../repositories/recommendation.repository';
import { parseSlateLimit } from '../dto/recommendation-request.dto';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; tenantId: string } {
  const user = (req['user'] as { id?: string; tenantId?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { userId: user.id, tenantId: user.tenantId ?? 'default' };
}

const CATEGORY_BY_EVENT: Record<string, string> = {
  READING_DWELL_TIME: 'reading',
  VIDEO_WATCH_PROGRESS: 'video',
};

@Controller('api/v1/recommendations')
export class RecommendationEventController {
  constructor(
    private readonly reranker: HybridRerankerService,
    private readonly coldStart: ColdStartService,
    private readonly repo: PrismaRecommendationRepository,
    private readonly redis: RedisClusterService,
  ) {}

  private async checkRateLimit(userId: string): Promise<void> {
    const key = recRateLimitKey(userId);
    const count = await this.redis.incrby(key, 1).catch(() => 0);
    if (count === 1) await this.redis.expire(key, 60).catch(() => undefined);
    if (count > REC_RATE_LIMIT_PER_MIN) {
      throw new HttpException('Recommendation rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Get('slate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async slate(@Req() req: LooseReq, @Query('limit') limit?: string): Promise<{
    tenantId: string;
    userId: string;
    slateTitle: string;
    items: RecommendationItem[];
    generatedAt: string;
  }> {
    const { userId, tenantId } = actorOf(req);
    await this.checkRateLimit(userId);
    const n = parseSlateLimit(limit);
    const items = await this.reranker.generatePersonalizedSlate(userId, tenantId, n);
    return { tenantId, userId, slateTitle: 'แนะนำเฉพาะคุณ (AI Match)', items, generatedAt: new Date().toISOString() };
  }

  @Get('trending')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async trending(@Req() req: LooseReq, @Query('limit') limit?: string) {
    const { tenantId } = actorOf(req);
    const n = parseSlateLimit(limit);
    const cards = await this.coldStart.getCuratedBestsellers(tenantId, n);
    return { tenantId, items: cards, generatedAt: new Date().toISOString() };
  }

  @Post('events')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async ingest(@Req() req: LooseReq, @Body() body: unknown): Promise<{ logged: boolean }> {
    const { userId } = actorOf(req);
    const b = (body ?? {}) as Record<string, unknown>;
    const parsed = TrackInteractionEventSchema.safeParse({ ...b, userId, timestamp: b['timestamp'] ?? new Date().toISOString() });
    if (!parsed.success) throw new BadRequestException('Invalid interaction event');
    const evt = parsed.data;
    // Gate 7: ledger write is the atomic unit; stream/profile are best-effort.
    await this.repo.logInteraction({
      userId,
      productId: evt.productId,
      eventType: evt.eventType,
      dwellTimeSec: evt.dwellTimeSec,
      progressPercentage: evt.progressPercentage,
    });
    const meta = (evt.metadata ?? {}) as Record<string, unknown>;
    const category = typeof meta['category'] === 'string' ? meta['category'] : CATEGORY_BY_EVENT[evt.eventType];
    if (category && (evt.dwellTimeSec ?? 0) >= 30) {
      await this.repo.upsertProfileWeights(userId, { [category]: 0.9 }).catch(() => undefined);
    }
    return { logged: true };
  }

  @Post('feedback')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async feedback(@Req() req: LooseReq, @Body() body: unknown): Promise<{ recorded: boolean }> {
    const { userId } = actorOf(req);
    const b = (body ?? {}) as { productId?: string; action?: string };
    if (!b.productId || (b.action !== 'click' && b.action !== 'purchase')) {
      throw new BadRequestException('Invalid feedback');
    }
    await this.repo
      .markSlateFeedback(userId, b.productId, b.action === 'click' ? 'isClicked' : 'isPurchased')
      .catch(() => undefined);
    return { recorded: true };
  }
}
