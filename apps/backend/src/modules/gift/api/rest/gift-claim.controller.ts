// SSOT Phase 089 — Gift claim REST (public magic-link + sender history)
// Canonical: apps/backend/src/modules/gift/api/rest/gift-claim.controller.ts
// (legacy class name GiftClaimControllerController renamed — no importers.)
// - POST create (sender JWT) / POST claim (public: code is the auth) /
//   GET detail / GET mine (JWT).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { CreateGiftOrderService } from '../../application/services/create-gift-order.service';
import { ClaimGiftService } from '../../application/services/claim-gift.service';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { PrismaGiftRepository } from '../../infrastructure/persistence/prisma-gift.repository';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function ctxUserOf(req: LooseReq): string | null {
  return (req['user'] as { id?: string } | undefined)?.id ?? null;
}

@Controller('api/v1/gifts')
export class GiftClaimController {
  constructor(
    private readonly create: CreateGiftOrderService,
    private readonly claim: ClaimGiftService,
    private readonly repo: PrismaGiftRepository,
  ) {}

  @Post('create')
  @UseGuards(JwtAuthGuard, TenantGuard)
  createGift(@Req() req: LooseReq, @Body() body: unknown) {
    return this.create.execute({ senderUserId: actorOf(req), input: (body ?? {}) as never });
  }

  @Post('claim')
  claimGift(@Req() req: LooseReq, @Body() body: unknown) {
    const userId = ctxUserOf(req);
    if (!userId) throw new BadRequestException('Claim requires sign-in');
    const code = (body as { claimCode?: string } | null)?.claimCode;
    if (!code) throw new BadRequestException('Missing claimCode');
    return this.claim.execute({ recipientUserId: userId, claimCode: code });
  }

  @Get('detail')
  async detail(@Query('code') code: string | undefined) {
    if (!code) throw new BadRequestException('Missing code');
    const repo: GiftRepository = this.repo;
    const gift = await repo.findByClaimCode(code);
    if (!gift) throw new BadRequestException('Gift not found');
    return {
      giftId: gift.id,
      claimCode: gift.claimCode,
      status: gift.status,
      productTitle: gift.product.title,
      productCoverUrl: gift.product.coverImageUrl,
      productType: gift.product.productType,
      senderName: gift.isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : gift.senderDisplayName,
      greetingTheme: gift.greetingTheme,
      greetingMessage: gift.greetingMessage,
      expiresAt: new Date(gift.expiresAt).toISOString(),
      claimedAt: gift.claimedAt ? new Date(gift.claimedAt).toISOString() : null,
      recipientName: gift.recipientUserId,
    };
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, TenantGuard)
  mine(@Req() req: LooseReq) {
    const repo: GiftRepository = this.repo;
    return repo.senderGifts(actorOf(req));
  }
}
