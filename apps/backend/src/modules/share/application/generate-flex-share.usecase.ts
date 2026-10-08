// SSOT Phase 080 Task 3/4 — Generate Flex share use-case (signed referral card)
// Canonical: apps/backend/src/modules/share/application/generate-flex-share.usecase.ts
// - Flow (BDD-1): 10/min rate gate (§8.1) -> Zod gate -> product fetch (404)
//   -> HMAC refToken sign -> tenant-themed mega-bubble build -> atomic
//   ShareEvent persist (P2002 → one re-sign retry, refToken embeds Date.now)
//   -> share stream event. Returns the §3.1 FlexSharePayload.
// - Does NOT duplicate the 026/079 builders (zero-redundant policy): this
//   mega-bubble card (discount strike + tenant CTA) is the 080 variant.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FlexShareInputSchema,
  FLEX_GENERATE_RATE_LIMIT,
  FLEX_SHARE_STREAM,
  FLEX_DEFAULT_ORIGIN,
  flexReferralUrl,
} from '@repo/shared';
import type { ShareRepository } from '../domain/share.repository';
import type { ShareCachePort } from '../infrastructure/share-redis.cache';
import { AttributionSigner } from '../domain/attribution.signer';
import { FlexBuilderEngine } from '../domain/flex-builder.engine';

export interface FlexGenerateTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

@Injectable()
export class GenerateFlexShareUseCase {
  constructor(
    private readonly repo: ShareRepository,
    private readonly cache: ShareCachePort,
    private readonly signer: AttributionSigner,
    private readonly builder: FlexBuilderEngine,
    private readonly tx: FlexGenerateTx,
  ) {}

  async execute(args: {
    tenantId: string;
    userId: string;
    affiliateCode: string;
    origin?: string;
    input: { productId: string; targetType: string; customMessage?: string };
  }): Promise<{ flexMessageJson: string; referralUrl: string; refToken: string; expiresAt: string }> {
    const hits = await this.cache.bumpGenerate(args.userId);
    if (hits > FLEX_GENERATE_RATE_LIMIT) {
      throw new ForbiddenException('Flex share rate limit exceeded (10/min)');
    }
    const parsed = FlexShareInputSchema.safeParse({ ...args.input, tenantId: args.tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid flex share input');

    const product = await this.repo.findProduct(parsed.data.productId);
    if (!product) throw new NotFoundException('Product not found');
    if (product.tenantId && product.tenantId !== args.tenantId) {
      throw new ForbiddenException('Cross-tenant share blocked.');
    }

    const origin = (args.origin ?? FLEX_DEFAULT_ORIGIN).replace(/\/$/, '');
    const refToken = this.signer.sign({
      userId: args.userId,
      productId: product.id,
      affiliateCode: args.affiliateCode,
    });
    const referralUrl = flexReferralUrl(origin, product.id, refToken);
    const { flexMessageJson } = this.builder.build({
      title: product.title,
      description: parsed.data.customMessage ?? product.description.slice(0, 120),
      coverImageUrl: product.coverImageUrl,
      price: product.price,
      ...(product.discountPrice != null ? { discountPrice: product.discountPrice } : {}),
      productType: product.productType,
      referralUrl,
      affiliateCode: args.affiliateCode,
    });

    const expiresAt = this.signer.expiresAt();
    try {
      await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        await repo.createShareEvent({
          userId: args.userId,
          productId: product.id,
          targetType: parsed.data.targetType,
          refToken,
        });
      });
    } catch {
      // refToken embeds Date.now — a P2002 means a same-ms double submit;
      // re-sign once with a fresh timestamp instead of failing the share.
      const retryToken = this.signer.sign({
        userId: args.userId,
        productId: product.id,
        affiliateCode: args.affiliateCode,
        issuedAt: Date.now() + 1,
      });
      const retryUrl = flexReferralUrl(origin, product.id, retryToken);
      await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        await repo.createShareEvent({
          userId: args.userId,
          productId: product.id,
          targetType: parsed.data.targetType,
          refToken: retryToken,
        });
      });
      await this.cache.emit(FLEX_SHARE_STREAM, {
        event: 'share.flex.generated',
        userId: args.userId,
        productId: product.id,
        at: Date.now(),
      });
      // NOTE: referralUrl appears twice in the card (hero + footer CTA).
      return { flexMessageJson: flexMessageJson.split(referralUrl).join(retryUrl), referralUrl: retryUrl, refToken: retryToken, expiresAt };
    }

    await this.cache.emit(FLEX_SHARE_STREAM, {
      event: 'share.flex.generated',
      userId: args.userId,
      productId: product.id,
      at: Date.now(),
    });
    return { flexMessageJson, referralUrl, refToken, expiresAt };
  }
}
