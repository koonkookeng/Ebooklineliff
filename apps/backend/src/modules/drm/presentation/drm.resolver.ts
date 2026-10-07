// SSOT Phase 049 — DrmResolver (code-first GraphQL intent layer §3.2)
// Canonical: apps/backend/src/modules/drm/presentation/drm.resolver.ts
// Runtime is code-first (autoSchemaFile); SDL supplement lives at
// apps/backend/src/api/graphql/schemas/drm.graphql/schema.graphql.
// - Mutation.initDrmSession(productId, pageNumber): entitlement-gated grant.
// - Query.getEbookPageDrmChunk(productId, pageNumber, sessionId): payload.
// - Mutation.reportPiracyViolation(sessionId, violationType, detailJson).
// - Zero new deps.
import { Args, Context, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { DrmSessionService } from '../services/drm-session.service';
import { resolveReaderIdentity, type ReaderGqlContext } from '../../reader/reader-identity';

@ObjectType('PixelTileMatrix')
class PixelTileMatrixGql {
  @Field(() => Int) tileWidth!: number;
  @Field(() => Int) tileHeight!: number;
  @Field(() => Int) gridCols!: number;
  @Field(() => Int) gridRows!: number;
  @Field(() => [Int]) permutationVector!: number[];
  @Field() seedHash!: string;
}

@ObjectType('DrmSessionHandshake')
class DrmSessionHandshakeGql {
  @Field(() => ID) sessionId!: string;
  @Field(() => ID) productId!: string;
  @Field(() => Int) pageNumber!: number;
  @Field() expiresAt!: string;
  @Field(() => PixelTileMatrixGql) tileMatrix!: PixelTileMatrixGql;
}

@ObjectType('ForensicData')
class ForensicDataGql {
  @Field() userIdHash!: string;
  @Field() tenantId!: string;
  @Field() ipAddressHash!: string;
  @Field() timestamp!: string;
}

@ObjectType('DecryptChunkPayload')
class DecryptChunkPayloadGql {
  @Field(() => Int) pageNumber!: number;
  @Field() encryptedChunkUrl!: string;
  @Field(() => DrmSessionHandshakeGql) drmSession!: DrmSessionHandshakeGql;
  @Field(() => ForensicDataGql) forensicData!: ForensicDataGql;
}

interface DrmGqlContext {
  req?: { user?: { id?: string }; ip?: string; headers?: Record<string, string | undefined> };
}

function clientIpOf(ctx: DrmGqlContext | undefined): string {
  const req = (ctx as unknown as { req?: { ip?: string; headers?: Record<string, string | undefined> } })?.req;
  return req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || 'unknown';
}

function tenantOf(ctx: DrmGqlContext | undefined): string | undefined {
  const req = (ctx as unknown as { req?: { headers?: Record<string, string | undefined> } })?.req;
  return req?.headers?.['x-tenant-id'];
}

@Resolver('Drm')
export class DrmResolver {
  constructor(private readonly sessions: DrmSessionService) {}

  @Mutation('initDrmSession')
  @UseGuards(JwtAuthGuard)
  async initDrmSession(
    @Args('productId') productId: string,
    @Args('pageNumber') pageNumber: number,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    if (!productId) throw new BadRequestException('Missing productId');
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.sessions.initDrmSession({
      userId,
      productId,
      pageNumber,
      tenantId: tenantOf(gqlCtx),
      imageWidth: 1024,
      imageHeight: 1400,
    });
  }

  @Query('getEbookPageDrmChunk')
  @UseGuards(JwtAuthGuard)
  async getEbookPageDrmChunk(
    @Args('productId') productId: string,
    @Args('pageNumber') pageNumber: number,
    @Args('sessionId') sessionId: string,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    const { userId } = resolveReaderIdentity(gqlCtx);
    return this.sessions.getDrmChunk({
      productId,
      pageNumber,
      sessionId,
      userId,
      tenantId: tenantOf(gqlCtx),
      ipAddress: clientIpOf(gqlCtx),
    });
  }

  @Mutation('reportPiracyViolation')
  @UseGuards(JwtAuthGuard)
  async reportPiracyViolation(
    @Args('sessionId') sessionId: string,
    @Args('violationType') violationType: string,
    @Args('detailJson', { nullable: true }) detailJson?: string,
    @Context() gqlCtx?: ReaderGqlContext,
  ) {
    let metadata: Record<string, unknown> | undefined;
    if (detailJson) {
      try {
        metadata = JSON.parse(detailJson) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('detailJson must be valid JSON');
      }
    }
    const req = (gqlCtx as unknown as { req?: { headers?: Record<string, string | undefined> } })?.req;
    return this.sessions.reportViolation({
      sessionId,
      violationType,
      ipAddress: clientIpOf(gqlCtx),
      userAgent: req?.headers?.['user-agent'] ?? 'unknown',
      metadata,
    });
  }
}
