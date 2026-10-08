// SSOT Phase 052 §3.2 — analytics GQL (pulses + heatmap reads, JWT-gated)
// Canonical: apps/backend/src/modules/analytics/resolvers/analytics.resolver.ts
// (legacy src/backend/api/graphql/analytics.resolver.ts — that path holds a
//  re-export alias; this file owns the implementation.)
// - Mutations validate Zod then fan into the same Redis Stream as REST (Gate 8).
// - Queries serve the instructor dashboard (Gate 8 read model).
// - Zero new deps.
import { Args, Context, Field, Float, ID, InputType, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import {
  ReadTimeTrackingPayloadSchema,
  WatchTimeTrackingPayloadSchema,
} from '@repo/shared';
import { AnalyticsStreamService } from '../services/analytics-stream.service';
import { HeatmapProcessorService } from '../services/heatmap-processor.service';

interface AnalyticsGqlContext {
  req?: { user?: { id?: string } };
}

@ObjectType('AnalyticsSyncResponse')
class AnalyticsSyncResponseGql {
  @Field() success!: boolean;
  @Field(() => Int) acknowledgedEvents!: number;
  @Field(() => Int) nextHeartbeatIntervalSec!: number;
}

@ObjectType('HeatmapSegment')
class HeatmapSegmentGql {
  @Field(() => Int) secondOffset!: number;
  @Field(() => Int) viewerCount!: number;
  @Field(() => Float) dropoffRate!: number;
}

@ObjectType('LessonHeatmapPayload')
class LessonHeatmapPayloadGql {
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) totalViews!: number;
  @Field(() => Float) averageCompletionRate!: number;
  @Field(() => [HeatmapSegmentGql]) heatmapSegments!: HeatmapSegmentGql[];
}

@ObjectType('PageDwellMetric')
class PageDwellMetricGql {
  @Field(() => Int) pageNumber!: number;
  @Field(() => Float) averageDwellSec!: number;
  @Field(() => Int) totalReads!: number;
}

@ObjectType('EbookAnalyticsPayload')
class EbookAnalyticsPayloadGql {
  @Field(() => ID) ebookId!: string;
  @Field(() => Int) totalPages!: number;
  @Field(() => [PageDwellMetricGql]) averageReadTimePerPages!: PageDwellMetricGql[];
}

@InputType('ReadTimeInput')
class ReadTimeInputGql {
  @Field(() => ID) productId!: string;
  @Field(() => ID) ebookId!: string;
  @Field(() => Int) pageNumber!: number;
  @Field(() => Int) dwellTimeSec!: number;
  @Field(() => Float, { nullable: true }) scrollDepthPercentage?: number | null;
}

@InputType('WatchTimeInput')
class WatchTimeInputGql {
  @Field(() => ID) productId!: string;
  @Field(() => ID) lessonId!: string;
  @Field(() => Int) watchedSec!: number;
  @Field(() => Int) currentTimestampSec!: number;
  @Field(() => Int) durationSec!: number;
}

function gqlUserId(ctx: AnalyticsGqlContext | undefined): string {
  const id = ctx?.req?.user?.id;
  if (!id) throw new BadRequestException('Missing session identity');
  return id;
}

@Resolver()
export class AnalyticsResolver {
  constructor(
    private readonly stream: AnalyticsStreamService,
    private readonly heatmap: HeatmapProcessorService,
  ) {}

  @Mutation(() => AnalyticsSyncResponseGql)
  @UseGuards(JwtAuthGuard)
  async recordReadTimePulse(
    @Args('input', { type: () => ReadTimeInputGql }) input: ReadTimeInputGql,
    @Context() ctx: AnalyticsGqlContext,
  ): Promise<AnalyticsSyncResponseGql> {
    const userId = gqlUserId(ctx);
    const parsed = ReadTimeTrackingPayloadSchema.safeParse({
      ...input,
      userId,
      timestamp: new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid read pulse');
    await this.stream.pushToStream({
      tenantId: 'default',
      deviceInfo: { userAgent: 'gql', isLiff: false },
      readEvents: [parsed.data],
      watchEvents: [],
    });
    return { success: true, acknowledgedEvents: 1, nextHeartbeatIntervalSec: 5 };
  }

  @Mutation(() => AnalyticsSyncResponseGql)
  @UseGuards(JwtAuthGuard)
  async recordWatchTimePulse(
    @Args('input', { type: () => WatchTimeInputGql }) input: WatchTimeInputGql,
    @Context() ctx: AnalyticsGqlContext,
  ): Promise<AnalyticsSyncResponseGql> {
    const userId = gqlUserId(ctx);
    const parsed = WatchTimeTrackingPayloadSchema.safeParse({
      ...input,
      userId,
      playbackRate: 1.0,
      timestamp: new Date().toISOString(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid watch pulse');
    await this.stream.pushToStream({
      tenantId: 'default',
      deviceInfo: { userAgent: 'gql', isLiff: false },
      readEvents: [],
      watchEvents: [parsed.data],
    });
    return { success: true, acknowledgedEvents: 1, nextHeartbeatIntervalSec: 5 };
  }

  @Query(() => LessonHeatmapPayloadGql)
  @UseGuards(JwtAuthGuard)
  async getLessonWatchHeatmap(
    @Args('lessonId', { type: () => ID }) lessonId: string,
    @Args('productId', { type: () => ID }) productId: string,
  ): Promise<LessonHeatmapPayloadGql> {
    if (!lessonId || !productId) throw new BadRequestException('Missing heatmap scope');
    return this.heatmap.getLessonWatchHeatmap(lessonId, productId);
  }

  @Query(() => EbookAnalyticsPayloadGql)
  @UseGuards(JwtAuthGuard)
  async getEbookPageDwellAnalytics(
    @Args('ebookId', { type: () => ID }) ebookId: string,
  ): Promise<EbookAnalyticsPayloadGql> {
    if (!ebookId) throw new BadRequestException('Missing ebook scope');
    return this.heatmap.getEbookPageDwellAnalytics(ebookId);
  }
}
