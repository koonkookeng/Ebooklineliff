// SSOT Phase 040 Task 40.1 — ReaderResolver (code-first intent layer, §3.2)
// Canonical: apps/backend/src/modules/reader/reader.resolver.ts
// (legacy src/backend/modules/reader/reader.resolver.ts)
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/reader.graphql/schema.graphql.
// - Query.getEbookPageChunk + Mutation.syncEbookProgress ride the same
//   entitled ReaderService as the REST controller (no HTTP hop).
// - Identity comes from the GraphQL @Context() (JwtAuthGuard attaches
//   req.user); tenant falls back to 'default' for token shapes without it.
// - Zero new deps.
import { Args, Context, Field, Float, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { NetworkQualityTierEnum } from '@repo/shared';
import { ReaderService } from './reader.service';
import { LowBandwidthReaderService } from './services/low-bandwidth-reader.service';
import { VectorChunkService } from './services/vector-chunk.service';
import { resolveReaderIdentity, type ReaderGqlContext } from './reader-identity';

@ObjectType('ForensicWatermarkPayload')
class ForensicWatermarkPayloadGql {
  @Field() watermarkText!: string;
  @Field() userIdHash!: string;
  @Field() timestamp!: string;
}

@ObjectType('EbookChunkPayload')
class EbookChunkPayloadGql {
  @Field(() => ID) productId!: string;
  @Field(() => Int) pageNumber!: number;
  @Field(() => Int) totalPages!: number;
  @Field() vectorSvgContent!: string;
  @Field(() => ForensicWatermarkPayloadGql) forensicWatermark!: ForensicWatermarkPayloadGql;
  @Field() hasPrevious!: boolean;
  @Field() hasNext!: boolean;
}

@ObjectType('ProgressSyncPayload')
class ProgressSyncPayloadGql {
  @Field() success!: boolean;
  @Field(() => Int) lastPage!: number;
  @Field() updatedAt!: string;
}

@ObjectType('EbookMultiResChunkPayload')
class EbookMultiResChunkPayloadGql {
  @Field(() => Int) pageNumber!: number;
  @Field() vectorSvgContent!: string;
  @Field() dprVariant!: string;
  @Field(() => ForensicWatermarkPayloadGql) forensicWatermarkData!: ForensicWatermarkPayloadGql;
  @Field(() => Float) memoryFootprintMb!: number;
  @Field() hasPrevious!: boolean;
  @Field() hasNext!: boolean;
}

@ObjectType('LowBandwidthChunkPayload')
class LowBandwidthChunkPayloadGql {
  @Field(() => Int) pageNumber!: number;
  @Field() compressedPayloadBase64!: string;
  @Field(() => Int) byteLength!: number;
  @Field() isLowBandwidthMode!: boolean;
  @Field() forensicWatermarkHash!: string;
  @Field() checksumSha256!: string;
}

@Resolver('Reader')
export class ReaderResolver {
  constructor(
    private readonly reader: ReaderService,
    private readonly lowband: LowBandwidthReaderService,
    private readonly vectors?: VectorChunkService,
  ) {}

  @Query('getEbookPageChunk')
  @UseGuards(JwtAuthGuard)
  async getEbookPageChunk(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const { userId, tenantId } = resolveReaderIdentity(gqlCtx);
    return this.reader.getEbookPageChunk(userId, tenantId, productId, pageNumber);
  }

  @Mutation('syncEbookProgress')
  @UseGuards(JwtAuthGuard)
  async syncEbookProgress(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Args('readDurationSec', { type: () => Int }) readDurationSec: number,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.reader.syncEbookProgress(userId, productId, pageNumber, readDurationSec);
  }

  // Phase 060 §3.2: retina multi-resolution chunk (DPR variant + watermark).
  @Query('getEbookRetinaPageChunk')
  @UseGuards(JwtAuthGuard)
  async getEbookRetinaPageChunk(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Args('deviceDpr', { type: () => Float }) deviceDpr: number,
    @Args('cssWidth', { type: () => Float }) cssWidth: number,
    @Args('cssHeight', { type: () => Float }) cssHeight: number,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    if (!this.vectors) throw new Error('Retina scaler unavailable');
    const { userId } = resolveReaderIdentity(gqlCtx);
    void cssWidth;
    void cssHeight;
    return this.vectors.getRetinaChunk(productId, pageNumber, deviceDpr, userId);
  }

  // Phase 055 §3.2: low-bandwidth optimized chunk (Brotli + watermark hash).
  @Query('getOptimizedEbookPageChunk')
  @UseGuards(JwtAuthGuard)
  async getOptimizedEbookPageChunk(
    @Args('productId') productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Args('networkQuality') networkQuality: string,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const { userId, tenantId } = resolveReaderIdentity(gqlCtx);
    const tier = NetworkQualityTierEnum.parse(networkQuality);
    return this.lowband.getCompressedVectorChunk(productId, pageNumber, tier, userId, tenantId);
  }
}
