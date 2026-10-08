// SSOT Phase 056 §3.2 — Viewport code-first GraphQL resolver
// Canonical: apps/backend/src/modules/viewport/viewport.resolver.ts
// - Query.getUniversalViewportConfig (entitlement-gated routing config).
// - Mutation.syncUniversalViewportState (cross-device progress/mode sync).
// - Identity via @Context(): JWT id, else x-user-id header (preview-resolver
//   precedent). Zero new deps.
import { Args, Context, Field, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ViewportRouterService } from './viewport.service';
import {
  ViewportCapabilitiesSchema,
  ViewportStateSyncInputSchema,
} from '@repo/shared';

interface ViewportGqlContext {
  req?: { user?: { id?: string }; headers?: Record<string, string | undefined> };
}

function gqlUserId(ctx: ViewportGqlContext | undefined): string {
  const id = ctx?.req?.user?.id ?? ctx?.req?.headers?.['x-user-id'];
  if (!id) throw new BadRequestException('Missing viewport identity');
  return id;
}

@ObjectType('ViewportWatermarkConfig')
class ViewportWatermarkConfigGql {
  @Field() watermarkText!: string;
  @Field() hashSignature!: string;
  @Field(() => Int) refreshIntervalSec!: number;
}

@ObjectType('ViewportConfigPayload')
class ViewportConfigPayloadGql {
  @Field(() => ID) productId!: string;
  @Field() recommendedMode!: string;
  @Field(() => Int) maxMemoryLimitMB!: number;
  @Field({ nullable: true }) hlsStreamUrl?: string;
  @Field({ nullable: true }) ebookChunkBaseUrl?: string;
  @Field(() => ViewportWatermarkConfigGql) watermarkConfig!: ViewportWatermarkConfigGql;
}

@InputType('ViewportStateSyncInput')
class ViewportStateSyncInputGql {
  @Field(() => ID) productId!: string;
  @Field() contentType!: string;
  @Field(() => Int, { nullable: true }) lastPageNumber?: number;
  @Field(() => Int, { nullable: true }) lastWatchedSec?: number;
  @Field() viewportMode!: string;
}

@ObjectType('ViewportSyncResponsePayload')
class ViewportSyncResponsePayloadGql {
  @Field() ok!: boolean;
  @Field() syncedAt!: string;
}

@Resolver(() => ViewportConfigPayloadGql)
export class ViewportResolver {
  constructor(private readonly router: ViewportRouterService) {}

  @Query(() => ViewportConfigPayloadGql, { name: 'getUniversalViewportConfig' })
  async getUniversalViewportConfig(
    @Args('productId', { type: () => ID }) productId: string,
    @Args('clientEnv') clientEnv: string,
    @Context() ctx: ViewportGqlContext,
  ): Promise<ViewportConfigPayloadGql> {
    const userId = gqlUserId(ctx);
    const caps = ViewportCapabilitiesSchema.parse(JSON.parse(clientEnv));
    const out = await this.router.resolveViewportConfig(userId, productId, caps);
    return { ...out, hlsStreamUrl: out.hlsStreamUrl ?? undefined, ebookChunkBaseUrl: out.ebookChunkBaseUrl ?? undefined };
  }

  @Mutation(() => ViewportSyncResponsePayloadGql, { name: 'syncUniversalViewportState' })
  async syncUniversalViewportState(
    @Args('input') input: ViewportStateSyncInputGql,
    @Context() ctx: ViewportGqlContext,
  ): Promise<ViewportSyncResponsePayloadGql> {
    const userId = gqlUserId(ctx);
    const parsed = ViewportStateSyncInputSchema.parse(input);
    const out = await this.router.syncViewportState(userId, parsed);
    return { ok: out.ok, syncedAt: out.syncedAt };
  }
}
