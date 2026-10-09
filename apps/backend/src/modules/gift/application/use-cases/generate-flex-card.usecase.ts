// SSOT Phase 089 Task 3 — Flex card generation use-case (re-share + preview)
// Canonical: apps/backend/src/modules/gift/application/use-cases/generate-flex-card.usecase.ts
// - Rebuilds the shareable Flex card for an existing gift (sender re-share,
//   claim-page preview). Claim URL + sender display (anon-aware).
// - Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { giftClaimUrl } from '@repo/shared';
import type { GiftRepository } from '../../domain/repository/gift.repository.interface';
import { LineFlexGiftBuilder } from '../../infrastructure/line/line-flex-gift.builder';

@Injectable()
export class GenerateFlexCardUseCase {
  constructor(
    private readonly repo: GiftRepository,
    private readonly flex: LineFlexGiftBuilder,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async execute(claimCode: string): Promise<{ flexMessageJson: string; claimUrl: string }> {
    if (!claimCode || claimCode.length < 8) throw new BadRequestException('Invalid claim code');
    const gift = await this.repo.findByClaimCode(claimCode);
    if (!gift) throw new NotFoundException('Gift not found');
    const claimUrl = giftClaimUrl(this.origin, gift.claimCode);
    const { flexMessageJson } = this.flex.build({
      productTitle: gift.product.title,
      coverImageUrl: gift.product.coverImageUrl,
      greetingTheme: gift.greetingTheme,
      greetingMessage: gift.greetingMessage,
      senderName: gift.isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : gift.senderDisplayName,
      claimUrl,
    });
    return { flexMessageJson, claimUrl };
  }
}
