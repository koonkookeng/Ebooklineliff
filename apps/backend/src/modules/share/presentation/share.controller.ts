// SSOT Phase 080 Task 4 — Share REST (flex-generate + track-click + metrics)
// Canonical: apps/backend/src/modules/share/presentation/share.controller.ts
// (ADDITIVE deviation from the §5.1 tree: the tree lists only a GQL resolver,
// but LIFF clients ride zero-dep REST proxies — same precedent as 026/079.
// GQL intents stay canonical in share.resolver.ts.)
// - POST flex-generate (JWT + TenantGuard, 10/min per user inside use-case).
// - POST track-click (public: recipients may be anonymous; IP/UA stamped).
// - GET metrics (JWT + TenantGuard, sharer-self scope).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ctrOf } from '@repo/shared';
import { PrismaShareRepository } from '../infrastructure/share.repository';
import { GenerateFlexShareUseCase } from '../application/generate-flex-share.usecase';
import { TrackClickUseCase } from '../application/track-click.usecase';

type LooseReq = Record<string, unknown>;

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function clientIp(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return (req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0';
}

@Controller('api/v1/share')
export class ShareController {
  constructor(
    private readonly generate: GenerateFlexShareUseCase,
    private readonly track: TrackClickUseCase,
    private readonly repo: PrismaShareRepository,
  ) {}

  @Post('flex-generate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async flexGenerate(@Req() req: LooseReq, @Body() body: unknown) {
    const tenantId = tenantOf(req);
    const userId = actorOf(req);
    const me = await this.repo.findUser(userId);
    if (!me) throw new BadRequestException('Sharer account not found');
    const b = (body ?? {}) as { productId?: string; targetType?: string; customMessage?: string };
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    return this.generate.execute({
      tenantId,
      userId,
      affiliateCode: me.affiliateCode,
      origin: headers['origin'] ?? undefined,
      input: { productId: b.productId ?? '', targetType: b.targetType ?? '', customMessage: b.customMessage },
    });
  }

  @Post('track-click')
  async trackClick(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { refToken?: string; visitorLineId?: string | null };
    if (!b.refToken) throw new BadRequestException('Missing refToken');
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    return this.track.execute({
      refToken: b.refToken,
      visitorLineId: b.visitorLineId ?? null,
      ipAddress: clientIp(req),
      userAgent: headers['user-agent'] ?? 'unknown',
    });
  }

  @Get('metrics')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async metrics(@Req() req: LooseReq, @Query('productId') productId: string | undefined) {
    const userId = actorOf(req);
    const m = await this.repo.shareMetrics({ userId, productId: productId || null });
    return { ...m, ctrPercentage: ctrOf(m.totalClicks, m.totalShares) };
  }
}
