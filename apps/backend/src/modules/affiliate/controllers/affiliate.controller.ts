// SSOT Phase 079 Task 3 — Affiliate REST (dashboard + links + payout)
// Canonical: apps/backend/src/modules/affiliate/controllers/affiliate.controller.ts
// - GET dashboard / POST referral-link / POST flex-share / POST payout —
//   JWT + TenantGuard (member-self scope; no merchant role needed).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ReferralLinkGenerateSchema, referralUrl } from '@repo/shared';
import { shortAffiliateCode } from '../domain/affiliate.entity';
import type { AffiliateRepository } from '../domain/affiliate.repository';
import { PrismaAffiliateRepository } from '../infrastructure/prisma-affiliate.repository';
import { FlexMessageBuilderService } from '../services/flex-message-builder.service';
import { PayoutService } from '../services/payout.service';

function tenantOf(req: Record<string, unknown>): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? headers['X-Tenant-ID'] ?? '') as string).trim();
}

function actorOf(req: Record<string, unknown>): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/affiliate')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AffiliateController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly flex: FlexMessageBuilderService,
    private readonly repo: PrismaAffiliateRepository,
  ) {}

  @Get('dashboard')
  dashboard(@Req() req: Record<string, unknown>) {
    return this.payouts.dashboard(actorOf(req));
  }

  @Post('referral-link')
  async referralLink(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const tenantId = tenantOf(req);
    const userId = actorOf(req);
    const parsed = ReferralLinkGenerateSchema.safeParse({ ...((body ?? {}) as Record<string, unknown>), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid referral link payload');
    const repo: AffiliateRepository = this.repo;
    const me = await repo.findUser(userId);
    if (!me) throw new BadRequestException('Affiliate account not found');
    const code = me.affiliateCode || shortAffiliateCode(userId);
    const origin = (req['origin'] as string | undefined) ?? 'https://liff.line.me';
    const shareUrl = referralUrl(origin, parsed.data.productId, code, parsed.data.customCampaignTag);
    const refToken = `${code}:${parsed.data.productId.slice(0, 8)}:${Date.now().toString(36)}`;
    await repo.createShareEvent({ userId, productId: parsed.data.productId, refToken }).catch(() => undefined);
    return { signedUrl: shareUrl, qrCodeUrl: shareUrl, affiliateCode: code };
  }

  @Post('flex-share')
  async flexShare(@Req() req: Record<string, unknown>, @Body() body: {
    productId: string; productTitle: string; coverImageUrl: string; price: number; campaignTag?: string;
  }) {
    const tenantId = tenantOf(req);
    const userId = actorOf(req);
    if (!body?.productId) throw new BadRequestException('Missing productId');
    const repo: AffiliateRepository = this.repo;
    const me = await repo.findUser(userId);
    if (!me) throw new BadRequestException('Affiliate account not found');
    const code = me.affiliateCode || shortAffiliateCode(userId);
    const origin = (req['origin'] as string | undefined) ?? 'https://liff.line.me';
    const shareUrl = referralUrl(origin, body.productId, code, body.campaignTag);
    return this.flex.build({
      productId: body.productId,
      productTitle: body.productTitle ?? 'แนะนำสิ่งนี้ให้คุณ',
      coverImageUrl: body.coverImageUrl ?? '',
      price: Number(body.price) || 0,
      affiliateCode: code,
      shareUrl,
      trackingCode: `${code.slice(0, 4)}-${body.productId.slice(0, 4)}`,
    });
  }

  @Post('payout')
  payout(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    return this.payouts.requestPayout(tenantOf(req), actorOf(req), body);
  }
}
