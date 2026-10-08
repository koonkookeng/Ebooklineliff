// SSOT Phase 051 §3.2 — PreviewResolver (code-first: 2 queries + 1 mutation)
// Canonical: apps/backend/src/modules/preview/resolvers/preview.resolver.ts
// (legacy src/backend/api/graphql/resolvers/preview.resolver.ts —
//  consolidated here per the §5.1 preview module tree; the legacy path holds
//  a re-export alias so both boundary paths resolve.)
// - Preview is PUBLIC: identity is optional (JWT id, else x-user-id header,
//   else anon). Never leaks full-book/video URLs — only gated chunk payloads.
// - Zero new deps.
import { Args, Context, Field, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import {
  EbookPreviewChunkPayloadSchema,
  PreviewAccessCheckSchema,
  PreviewEventInputSchema,
  VideoPreviewStreamPayloadSchema,
} from '@repo/shared';
import { EbookChunkService } from '../services/ebook-chunk.service';
import { PreviewGatekeeperService, type PreviewIdentity } from '../services/preview-gatekeeper.service';
import { PreviewHlsTokenService } from '../services/hls-token.service';

interface PreviewGqlContext {
  req?: { user?: { id?: string }; headers?: Record<string, string | undefined> };
}

function gqlIdentity(ctx: PreviewGqlContext | undefined): PreviewIdentity {
  return {
    userId: ctx?.req?.user?.id ?? ctx?.req?.headers?.['x-user-id'] ?? null,
    lineUserId: ctx?.req?.headers?.['x-line-user-id'],
  };
}

@ObjectType('PreviewWatermarkData')
class PreviewWatermarkDataGql {
  @Field() watermarkText!: string;
  @Field() userIdHash!: string;
  @Field() timestamp!: string;
}

@ObjectType('EbookPreviewChunkPayload')
class EbookPreviewChunkPayloadGql {
  @Field(() => ID) productId!: string;
  @Field(() => Int) pageNumber!: number;
  @Field(() => Int) totalPreviewPages!: number;
  @Field() isLastPreviewPage!: boolean;
  @Field() vectorSvgContent!: string;
  @Field(() => PreviewWatermarkDataGql) forensicWatermarkData!: PreviewWatermarkDataGql;
  @Field() hasEntitlement!: boolean;
}

@ObjectType('VideoPreviewStreamPayload')
class VideoPreviewStreamPayloadGql {
  @Field(() => ID) lessonId!: string;
  @Field() hlsPreviewPlaylistUrl!: string;
  @Field(() => Int) maxAllowedSeconds!: number;
  @Field() previewToken!: string;
  @Field() hasEntitlement!: boolean;
}

@InputType('PreviewEventInput')
class PreviewEventInputGql {
  @Field(() => ID) productId!: string;
  @Field() contentType!: string;
  @Field(() => Int) reachedValue!: number;
  @Field() action!: string;
}

@Resolver()
export class PreviewResolver {
  constructor(
    private readonly gate: PreviewGatekeeperService,
    private readonly chunks: EbookChunkService,
    private readonly tokens: PreviewHlsTokenService,
  ) {}

  @Query(() => EbookPreviewChunkPayloadGql)
  async getEbookPreviewChunk(
    @Args('productId', { type: () => ID }) productId: string,
    @Args('pageNumber', { type: () => Int }) pageNumber: number,
    @Context() ctx: PreviewGqlContext,
  ): Promise<EbookPreviewChunkPayloadGql> {
    const parsed = PreviewAccessCheckSchema.safeParse({ productId, contentType: 'EBOOK', targetPage: pageNumber });
    if (!parsed.success || !parsed.data.targetPage) throw new BadRequestException('Invalid preview chunk query');
    const payload = await this.chunks.getPreviewChunk(gqlIdentity(ctx), productId, parsed.data.targetPage);
    const checked = EbookPreviewChunkPayloadSchema.parse(payload);
    return { ...checked, forensicWatermarkData: { ...checked.forensicWatermarkData } };
  }

  @Query(() => VideoPreviewStreamPayloadGql)
  async getVideoPreviewStream(
    @Args('lessonId', { type: () => ID }) lessonId: string,
    @Context() ctx: PreviewGqlContext,
  ): Promise<VideoPreviewStreamPayloadGql> {
    const verdict = await this.gate.validateVideoPreviewAccess(gqlIdentity(ctx), lessonId);
    if (!verdict.isPreviewMode) {
      return {
        lessonId,
        hlsPreviewPlaylistUrl: '',
        maxAllowedSeconds: verdict.maxAllowedSec,
        previewToken: '',
        hasEntitlement: true,
      };
    }
    const payload = {
      lessonId,
      hlsPreviewPlaylistUrl: `/api/v1/preview/video/playlist?lessonId=${lessonId}`,
      maxAllowedSeconds: verdict.maxAllowedSec,
      previewToken: this.tokens.mintSegmentToken(lessonId, 'playlist'),
      hasEntitlement: false,
    };
    return VideoPreviewStreamPayloadSchema.parse(payload);
  }

  @Mutation(() => Boolean)
  async recordPreviewEvent(
    @Args('input', { type: () => PreviewEventInputGql }) input: PreviewEventInputGql,
    @Context() ctx: PreviewGqlContext,
  ): Promise<boolean> {
    const parsed = PreviewEventInputSchema.safeParse(input ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid preview event');
    return this.gate.recordPreviewEvent(gqlIdentity(ctx), parsed.data);
  }
}
