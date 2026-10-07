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
import { Args, Context, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { ReaderService } from './reader.service';
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

@Resolver('Reader')
export class ReaderResolver {
  constructor(private readonly reader: ReaderService) {}

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
}
