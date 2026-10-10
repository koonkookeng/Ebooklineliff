// SSOT Phase 112 Task 6 §3.2 — moderation GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/moderation/resolvers/moderation.resolver.ts
// - Query.getModerationQueue (admin) / Query.getContentModerationStatus
//   (owner/admin) / Mutation.triggerContentRescan (rate-shielded) /
//   Mutation.submitCreatorAppeal (LIFF self) /
//   Mutation.adminReviewModeration (admin atomic overrule).
// - Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { ModerationEngineService } from '../services/moderation-engine.service';
import { AppealManagerService } from '../services/appeal-manager.service';

@ObjectType('ModerationResultPayload')
class ModerationResultPayloadGql {
  @Field() id!: string;
  @Field() productId!: string;
  @Field() status!: string;
  @Field(() => Float) confidenceScore!: number;
  @Field(() => [String]) flaggedCategories!: string[];
  @Field(() => [String]) violatingLocations!: string[];
  @Field({ nullable: true }) aiAnalysisSummary!: string | null;
  @Field({ nullable: true }) scannedAt!: string | null;
}

@ObjectType('CreatorAppealResultPayload')
class CreatorAppealResultPayloadGql {
  @Field() appealId!: string;
  @Field() productId!: string;
  @Field() status!: string;
}

@ObjectType('ModerationQueueResponse')
class ModerationQueueResponseGql {
  @Field(() => [ModerationResultPayloadGql]) items!: ModerationResultPayloadGql[];
  @Field(() => Int) totalCount!: number;
  @Field(() => Int) quarantinedCount!: number;
  @Field(() => Int) appealPendingCount!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role?: string; tenant: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return {
    userId: user.id,
    ...(user.role ? { role: user.role } : {}),
    tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default',
  };
}

function toPayload(row: Record<string, unknown>): ModerationResultPayloadGql {
  const out = new ModerationResultPayloadGql();
  out.id = String(row['id'] ?? '');
  out.productId = String(row['productId'] ?? '');
  out.status = String(row['status'] ?? '');
  out.confidenceScore = Number(row['confidenceScore'] ?? 0);
  out.flaggedCategories = (row['flaggedCategories'] as string[] | undefined) ?? [];
  out.violatingLocations = (row['violatingPages'] as string[] | undefined) ?? (row['violatingLocations'] as string[] | undefined) ?? [];
  out.aiAnalysisSummary = (row['aiAnalysisSummary'] as string | null | undefined) ?? null;
  out.scannedAt = (row['scannedAt'] as string | null | undefined) ?? null;
  return out;
}

@Resolver('Moderation')
export class ModerationResolver {
  constructor(
    private readonly engine: ModerationEngineService,
    private readonly appeals: AppealManagerService,
  ) {}

  @Query('getModerationQueue')
  async getModerationQueue(
    @Args('status', { nullable: true }) status: string | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Args('offset', { nullable: true }) offset: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    const page = offset && limit ? Math.floor(offset / limit) + 1 : 1;
    const out = await this.engine.getQueue(c.role, {
      ...(status ? { status } : {}),
      page,
      ...(limit ? { limit } : {}),
    });
    return {
      items: (out.items as Record<string, unknown>[]).map(toPayload),
      totalCount: out.totalCount,
      quarantinedCount: out.quarantinedCount,
      appealPendingCount: out.appealPendingCount,
    };
  }

  @Query('getContentModerationStatus')
  async getContentModerationStatus(@Args('productId') productId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    const row = (await this.engine.getStatus(productId, { id: c.userId, role: c.role })) as Record<string, unknown>;
    return toPayload({ id: row['id'] ?? '', ...row });
  }

  @Mutation('triggerContentRescan')
  async triggerContentRescan(@Args('productId') productId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    const v = await this.engine.triggerRescan(productId, c.tenant);
    return toPayload({
      id: '',
      productId: v.productId,
      status: v.status,
      confidenceScore: v.confidenceScore,
      flaggedCategories: v.flaggedCategories,
      violatingPages: v.violatingLocations,
      scannedAt: new Date().toISOString(),
    });
  }

  @Mutation('submitCreatorAppeal')
  async submitCreatorAppeal(
    @Args('productId') productId: string,
    @Args('appealReason') appealReason: string,
    @Args('proofUrls', { nullable: true }) proofUrls: string[] | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    const out = await this.appeals.submitAppeal(c.userId, { productId, appealReason, proofDocumentUrls: proofUrls ?? [] });
    const res = new CreatorAppealResultPayloadGql();
    res.appealId = out.appealId;
    res.productId = out.productId;
    res.status = out.status;
    return res;
  }

  @Mutation('adminReviewModeration')
  adminReviewModeration(
    @Args('productId') productId: string,
    @Args('approve') approve: boolean,
    @Args('adminNotes') adminNotes: string,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    return this.appeals.decideAppeal({ id: c.userId, role: c.role }, { productId, approve, adminNotes }, c.tenant);
  }
}
