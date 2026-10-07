// SSOT Phase 042 Task 4 — WatermarkResolver (code-first, §3.2)
// Canonical: apps/backend/src/modules/watermark/infrastructure/graphql/watermark.resolver.ts
// (legacy src/backend/modules/watermark/infrastructure/graphql/watermark.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/watermark.graphql/schema.graphql.
// - Query.getWatermarkSeed(productId): JWT identity + client IP → handler.
// - Mutation.extractForensicWatermark: manifest-assisted verify (ADR-042 —
//   pixel decode stays client-side, the canvas submits its alpha manifest).
// - Zero new deps.
import { Args, Context, Field, Float, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../../reader/reader-identity';
import { ForensicExtractorService } from '../../application/services/forensic-extractor.service';
import { GetWatermarkSeedHandler } from '../../application/queries/get-watermark-seed.handler';

@ObjectType('WatermarkConfig')
class WatermarkConfigGql {
  @Field(() => Float) opacityMin!: number;
  @Field(() => Float) opacityMax!: number;
  @Field(() => Int) fontSizePx!: number;
  @Field() motionMode!: string;
  @Field() steganographyEnabled!: boolean;
}

@ObjectType('WatermarkSeedPayload')
class WatermarkSeedPayloadGql {
  @Field() seedId!: string;
  @Field() userIdHash!: string;
  @Field({ nullable: true }) lineUserId?: string | null;
  @Field() displayName!: string;
  @Field() clientIp!: string;
  @Field() timestamp!: string;
  @Field() hmacSignature!: string;
  @Field(() => WatermarkConfigGql) config!: WatermarkConfigGql;
}

@ObjectType('ForensicVerificationResult')
class ForensicVerificationResultGql {
  @Field() extractedUserIdHash!: string;
  @Field({ nullable: true }) extractedLineUserId?: string | null;
  @Field() extractedTimestamp!: string;
  @Field(() => Float) confidenceScore!: number;
  @Field() isTampered!: boolean;
}

interface WatermarkHttpReq {
  ip?: string;
  headers?: Record<string, string | undefined>;
  user?: { id?: string; tenantId?: string; lineUserId?: string | null };
}

function clientIpOf(ctx: ReaderGqlContext | undefined): string {
  const req = (ctx as unknown as { req?: WatermarkHttpReq })?.req;
  const forwarded = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
  return forwarded || req?.ip || 'unknown';
}

@Resolver('Watermark')
export class WatermarkResolver {
  constructor(
    private readonly seeds: GetWatermarkSeedHandler,
    private readonly forensics: ForensicExtractorService,
  ) {}

  @Query('getWatermarkSeed')
  @UseGuards(JwtAuthGuard)
  async getWatermarkSeed(@Args('productId') productId: string, @Context() gqlCtx?: ReaderGqlContext) {
    if (!productId) throw new BadRequestException('Missing product id');
    const { userId } = resolveReaderIdentity(gqlCtx);
    const req = (gqlCtx as unknown as { req?: WatermarkHttpReq })?.req;
    const lineUserId = req?.user?.lineUserId ?? undefined;
    return this.seeds.execute({
      userId,
      lineUserId,
      displayName: lineUserId ?? `reader-${userId.slice(0, 8)}`,
      productId,
      clientIp: clientIpOf(gqlCtx),
      userAgent: req?.headers?.['user-agent'] ?? 'liff-webview',
    });
  }

  @Mutation('extractForensicWatermark')
  @UseGuards(JwtAuthGuard)
  async extractForensicWatermark(
    @Args('imageDataBase64') imageDataBase64: string,
    @Args('seedId') seedId: string,
    @Args('userIdHash') userIdHash: string,
    @Args('timestamp') timestamp: string,
    @Args('hmacSignature') hmacSignature: string,
  ) {
    if (!imageDataBase64 || !seedId || !hmacSignature) throw new BadRequestException('Missing forensic manifest');
    return this.forensics.verify(imageDataBase64, { seedId, userIdHash, timestamp, hmacSignature });
  }
}
