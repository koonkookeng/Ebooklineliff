// SSOT Phase 089 BDD-1 — Create gift order service (PENDING→Flex card)
// Canonical: apps/backend/src/modules/gift/application/services/create-gift-order.service.ts
// (legacy class name CreateGiftOrderServiceService renamed — no importers.)
// - Flow: Zod gate -> product exists -> claimCode mint -> PENDING_PAYMENT
//   row (payment binds later via bindOrder — payment core untouched) ->
//   Flex card + claim URL -> GIFT_CREATED stream.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateGiftOrderInputSchema,
  GIFT_STREAM,
  giftClaimCode,
  giftClaimUrl,
  giftExpiryAt,
} from '@repo/shared';
import { GIFT_CREATED_EVENT } from '../../domain/events/gift-created.event';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { LineFlexGiftBuilder } from '../../infrastructure/line/line-flex-gift.builder';

export interface GiftBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CreateGiftOrderService {
  constructor(
    private readonly repo: GiftRepository,
    private readonly flex: LineFlexGiftBuilder,
    private readonly bus: GiftBus,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(args: {
    senderUserId: string;
    input: {
      productId: string; greetingTheme: string; greetingMessage: string;
      senderDisplayName: string; isAnonymous?: boolean; expiryDays?: number;
    };
  }): Promise<{ giftId: string; claimCode: string; flexMessageJson: string; claimUrl: string; expiresAt: string }> {
    const parsed = CreateGiftOrderInputSchema.safeParse({ ...args.input, tenantId: 'default' });
    if (!parsed.success) throw new BadRequestException('Invalid gift order input');
    const product = await this.repo.findProduct(parsed.data.productId);
    if (!product) throw new NotFoundException('Product not found');

    const now = Date.now();
    const claimCode = giftClaimCode(now);
    const expiresAt = giftExpiryAt(now, parsed.data.expiryDays);
    const row = await this.repo.createGift({
      senderUserId: args.senderUserId,
      productId: product.id,
      claimCode,
      greetingTheme: parsed.data.greetingTheme,
      greetingMessage: parsed.data.greetingMessage,
      senderDisplayName: parsed.data.senderDisplayName,
      isAnonymous: parsed.data.isAnonymous,
      expiresAt: new Date(expiresAt),
    });

    const senderName = parsed.data.isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : parsed.data.senderDisplayName;
    const claimUrl = giftClaimUrl(this.origin, claimCode);
    const { flexMessageJson } = this.flex.build({
      productTitle: product.title,
      coverImageUrl: product.coverImageUrl,
      greetingTheme: parsed.data.greetingTheme,
      greetingMessage: parsed.data.greetingMessage,
      senderName,
      claimUrl,
    });

    await this.bus
      .xadd(GIFT_STREAM, {
        event: GIFT_CREATED_EVENT,
        giftId: row.id,
        claimCode,
        senderUserId: args.senderUserId,
        productId: product.id,
        at: now,
      })
      .catch(() => undefined);
    return { giftId: row.id, claimCode, flexMessageJson, claimUrl, expiresAt };
  }
}
