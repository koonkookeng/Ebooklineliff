// SSOT Phase 052 §7.2 — heatmap read model (instructor dashboard payloads)
// Canonical: apps/backend/src/modules/analytics/services/heatmap-processor.service.ts
// (legacy src/backend/modules/analytics/services/heatmap-processor.service.ts)
// - Pure read path over ContentHeatmapAggregate (+ VideoWatchAnalytics mean
//   completion). No writes here (Gate 7). Zero new deps.
import { Injectable } from '@nestjs/common';
import { dropoffRate } from '@repo/shared';

export interface HeatmapReaderDbPort {
  contentHeatmapAggregate: {
    findMany(a: unknown): Promise<
      Array<{ segmentIndex: number; viewCount: number; totalDwellTimeSec: bigint | number; dropoffCount: number }>
    >;
  };
  videoWatchAnalytics: {
    aggregate(a: unknown): Promise<{ _avg: { completionRate: number | null }; _count: number }>;
  };
  ebookPageAnalytics: {
    groupBy(a: unknown): Promise<Array<{ pageNumber: number; _avg: { dwellTimeSec: number | null }; _count: number }>>;
  };
}

export interface LessonHeatmapPayload {
  lessonId: string;
  totalViews: number;
  averageCompletionRate: number;
  heatmapSegments: Array<{ secondOffset: number; viewerCount: number; dropoffRate: number }>;
}

export interface EbookAnalyticsPayload {
  ebookId: string;
  totalPages: number;
  averageReadTimePerPages: Array<{ pageNumber: number; averageDwellSec: number; totalReads: number }>;
}

@Injectable()
export class HeatmapProcessorService {
  constructor(private readonly db: HeatmapReaderDbPort) {}

  async getLessonWatchHeatmap(lessonId: string, productId: string): Promise<LessonHeatmapPayload> {
    const [cells, stats] = await Promise.all([
      this.db.contentHeatmapAggregate.findMany({
        where: { productId, contentType: 'ELEARNING_COURSE' },
        orderBy: { segmentIndex: 'asc' },
      }),
      this.db.videoWatchAnalytics.aggregate({ where: { lessonId }, _avg: { completionRate: true }, _count: true }),
    ]);
    const totalViews = stats._count;
    return {
      lessonId,
      totalViews,
      averageCompletionRate: stats._avg.completionRate ?? 0,
      heatmapSegments: cells.map((c) => ({
        secondOffset: c.segmentIndex * 5,
        viewerCount: c.viewCount,
        dropoffRate: dropoffRate(c.dropoffCount, c.viewCount),
      })),
    };
  }

  async getEbookPageDwellAnalytics(ebookId: string): Promise<EbookAnalyticsPayload> {
    const rows = await this.db.ebookPageAnalytics.groupBy({
      by: ['pageNumber'],
      where: { ebookId },
      _avg: { dwellTimeSec: true },
      _count: true,
      orderBy: { pageNumber: 'asc' },
    });
    const metrics = rows.map((r) => ({
      pageNumber: r.pageNumber,
      averageDwellSec: r._avg.dwellTimeSec ?? 0,
      totalReads: r._count,
    }));
    const totalPages = metrics.length > 0 ? Math.max(...metrics.map((m) => m.pageNumber)) : 0;
    return { ebookId, totalPages, averageReadTimePerPages: metrics };
  }
}
