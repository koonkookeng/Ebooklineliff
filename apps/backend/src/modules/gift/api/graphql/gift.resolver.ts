// SSOT Phase 089 Task 4 — Gift GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/gift/api/graphql/gift.resolver.ts
// (legacy class name GiftResolverResolver renamed — no importers.)
// - Mutation.createGiftOrder / claimGiftEntitlement (public magic-link) /
//   bindGiftPayment. Query.giftDetail / mySentGifts / giftKFactor.
// - Zero new deps.
import { Args, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { giftKFactor } from '@repo/shared';
import { assertBindable } from '../../domain/entities/gift-order.entity';
import { CreateGiftOrderService } from '../../application/services/create-gift-order.service';
import { ClaimGiftService } from '../../application/services/claim-gift.service';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { PrismaGiftRepository } from '../../infrastructure/persistence/prisma-gift.repository';
import { CreateGiftPayloadGql, ClaimGiftResultGql, GiftDetailGql, GiftKFactorGql } from './gift.type';

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string | null; tenantId: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  return { userId: user.id ?? null, tenantId };
}

function actorOf(ctx: LooseCtx): string {
  const { userId } = ctxOf(ctx);
  if (!userId) throw new BadRequestException('Missing authentication');
  return userId;
}

function detailOf(gift: {
  id: string; claimCode: string; status: string;
  product: { title: string; coverImageUrl: string; productType: string };
  senderDisplayName: string; isAnonymous: boolean; greetingTheme: string;
  greetingMessage: string; expiresAt: Date; claimedAt: Date | null;
  recipientUserId: string | null;
}): GiftDetailGql {
  const out = new GiftDetailGql();
  out.giftId = gift.id;
  out.claimCode = gift.claimCode;
  out.status = gift.status;
  out.productTitle = gift.product.title;
  out.productCoverUrl = gift.product.coverImageUrl;
  out.productType = gift.product.productType;
  out.senderName = gift.isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : gift.senderDisplayName;
  out.greetingTheme = gift.greetingTheme;
  out.greetingMessage = gift.greetingMessage;
  out.expiresAt = new Date(gift.expiresAt).toISOString();
  out.claimedAt = gift.claimedAt ? new Date(gift.claimedAt).toISOString() : null;
  out.recipientName = gift.recipientUserId;
  return out;
}

@Resolver('Gift')
export class GiftResolver {
  constructor(
    private readonly create: CreateGiftOrderService,
    private readonly claim: ClaimGiftService,
    private readonly repo: PrismaGiftRepository,
  ) {}

  @Mutation('createGiftOrder')
  createGiftOrder(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    return this.create.execute({ senderUserId: actorOf(ctx), input: input as never });
  }

  @Mutation('claimGiftEntitlement')
  claimGiftEntitlement(@Args('claimCode') claimCode: string, @Context() ctx: LooseCtx) {
    const { userId } = ctxOf(ctx);
    if (!userId) throw new BadRequestException('Claim requires sign-in');
    return this.claim.execute({ recipientUserId: userId, claimCode });
  }

  @Mutation('bindGiftPayment')
  async bindGiftPayment(
    @Args('giftId') giftId: string,
    @Args('orderId') orderId: string,
    @Context() ctx: LooseCtx,
  ): Promise<boolean> {
    const repo: GiftRepository = this.repo;
    const gift = await repo.findById(giftId);
    if (!gift || gift.senderUserId !== actorOf(ctx)) throw new BadRequestException('Gift not found');
    assertBindable(gift.status);
    await repo.bindOrder(giftId, orderId);
    return true;
  }

  @Query('giftDetail')
  async giftDetail(@Args('claimCode') claimCode: string) {
    const repo: GiftRepository = this.repo;
    const gift = await repo.findByClaimCode(claimCode);
    return gift ? detailOf(gift) : null;
  }

  @Query('mySentGifts')
  async mySentGifts(@Context() ctx: LooseCtx) {
    const repo: GiftRepository = this.repo;
    const rows = await repo.senderGifts(actorOf(ctx));
    return Promise.all(
      rows.map(async (r) => {
        const full = await repo.findByClaimCode(r.claimCode);
        return full ? detailOf(full) : null;
      }),
    ).then((all) => all.filter((x): x is GiftDetailGql => x !== null));
  }

  @Query('giftKFactor')
  async giftKFactor(@Context() ctx: LooseCtx) {
    const repo: GiftRepository = this.repo;
    const rows = await repo.senderGifts(actorOf(ctx));
    const sent = rows.length;
    const claimed = rows.filter((r) => r.status === 'CLAIMED').length;
    const out = new GiftKFactorGql();
    out.sent = sent;
    out.claimed = claimed;
    out.kFactor = giftKFactor(sent, claimed);
    return out;
  }
}
