// SSOT Phase 052 §7.1 — batch drain writer (Redis Stream → PostgreSQL 16, async)
// Canonical: apps/backend/src/modules/analytics/services/analytics-aggregation.service.ts
// (legacy src/backend/modules/analytics/services/analytics-aggregation.service.ts)
// - Raw page rows are append-only; watch rows upsert by @@unique(userId,lessonId)
//   with monotonic maxWatchedSec; heatmap cells upsert-increment by
//   @@unique(productId,contentType,segmentIndex) (Gate 7: idempotent replays).
// - Drop-off accounting: a WATCH pulse whose currentTimestampSec REGRESSES vs
//   the stored max marks the abandoned segment (seek-back ⇒ drop-off at the
//   resumed position's segment, §7.2).
import { Injectable } from '@nestjs/common';
import { completionRate, heatmapSegmentIndex } from '@repo/shared';

export interface AnalyticsStreamEntry {
  type: 'READ' | 'WATCH';
  userId: string;
  ebookId?: string;
  lessonId?: string;
  productId: string;
  pageNumber?: number;
  dwellTimeSec?: number;
  scrollDepth?: number;
  watchedSec?: number;
  currentTimestampSec?: number;
  durationSec?: number;
}

export interface AnalyticsWriterDbPort {
  ebookPageAnalytics: {
    create(a: unknown): Promise<unknown>;
  };
  videoWatchAnalytics: {
    findUnique(a: unknown): Promise<{ maxWatchedSec: number; watchedSec: number } | null>;
    upsert(a: unknown): Promise<unknown>;
  };
  contentHeatmapAggregate: {
    upsert(a: unknown): Promise<unknown>;
  };
  /** Lesson → product resolution (server-authoritative heatmap keying). */
  courseLesson?: {
    findUnique(a: unknown): Promise<{ section: { course: { productId: string } } } | null>;
  };
}

function heatmapUpsert(
  db: AnalyticsWriterDbPort,
  productId: string,
  contentType: 'EBOOK' | 'ELEARNING_COURSE',
  segmentIndex: number,
  dwell: number,
  dropoff: number,
): Promise<unknown> {
  const where = { productId_contentType_segmentIndex: { productId, contentType, segmentIndex } };
  return db.contentHeatmapAggregate.upsert({
    where,
    update: {
      viewCount: { increment: 1 },
      totalDwellTimeSec: { increment: dwell },
      dropoffCount: { increment: dropoff },
    },
    create: { productId, contentType, segmentIndex, viewCount: 1, totalDwellTimeSec: dwell, dropoffCount: dropoff },
  });
}

@Injectable()
export class AnalyticsAggregationService {
  constructor(private readonly db: AnalyticsWriterDbPort) {}

  async drainBatch(entries: AnalyticsStreamEntry[]): Promise<{ written: number }> {
    let written = 0;
    for (const e of entries) {
      if (e.type === 'READ' && e.ebookId && e.pageNumber && e.dwellTimeSec) {
        await this.drainRead(e as Required<Pick<AnalyticsStreamEntry, 'userId' | 'ebookId' | 'productId' | 'pageNumber' | 'dwellTimeSec'>> & { scrollDepth?: number });
        written++;
      } else if (e.type === 'WATCH' && e.lessonId && e.watchedSec && e.currentTimestampSec !== undefined && e.durationSec) {
        await this.drainWatch(e as Required<Pick<AnalyticsStreamEntry, 'userId' | 'lessonId' | 'productId' | 'watchedSec' | 'currentTimestampSec' | 'durationSec'>>);
        written++;
      }
    }
    return { written };
  }

  private async drainRead(e: {
    userId: string;
    ebookId: string;
    productId: string;
    pageNumber: number;
    dwellTimeSec: number;
    scrollDepth?: number;
  }): Promise<void> {
    await this.db.ebookPageAnalytics.create({
      data: {
        userId: e.userId,
        ebookId: e.ebookId,
        pageNumber: e.pageNumber,
        dwellTimeSec: Math.min(3600, Math.max(1, Math.floor(e.dwellTimeSec))),
        scrollDepth: e.scrollDepth ?? 100,
        interactionCount: 1,
      },
    });
    await heatmapUpsert(this.db, e.productId, 'EBOOK', e.pageNumber, Math.floor(e.dwellTimeSec), 0).catch(() => undefined);
  }

  private async drainWatch(e: {
    userId: string;
    lessonId: string;
    productId: string;
    watchedSec: number;
    currentTimestampSec: number;
    durationSec: number;
  }): Promise<void> {
    const prev = await this.db.videoWatchAnalytics
      .findUnique({ where: { userId_lessonId: { userId: e.userId, lessonId: e.lessonId } } })
      .catch(() => null);
    // Server-authoritative product key (client only knows the course/lesson scope).
    const productId = await this.db.courseLesson
      ?.findUnique({ where: { id: e.lessonId }, include: { section: { include: { course: true } } } })
      .then((l) => l?.section.course.productId ?? e.productId)
      .catch(() => e.productId) ?? e.productId;
    const prevMax = prev?.maxWatchedSec ?? 0;
    const maxWatchedSec = Math.max(prevMax, Math.floor(e.currentTimestampSec));
    // Seek-back past the furthest point ⇒ viewer abandoned the resumed segment.
    const dropoff = Math.floor(e.currentTimestampSec) < prevMax ? 1 : 0;
    await this.db.videoWatchAnalytics.upsert({
      where: { userId_lessonId: { userId: e.userId, lessonId: e.lessonId } },
      update: {
        watchedSec: { increment: Math.floor(e.watchedSec) },
        maxWatchedSec,
        lastPositionSec: Math.floor(e.currentTimestampSec),
        completionRate: completionRate(maxWatchedSec, e.durationSec),
      },
      create: {
        userId: e.userId,
        lessonId: e.lessonId,
        watchedSec: Math.floor(e.watchedSec),
        maxWatchedSec,
        lastPositionSec: Math.floor(e.currentTimestampSec),
        completionRate: completionRate(maxWatchedSec, e.durationSec),
      },
    });
    await heatmapUpsert(
      this.db,
      productId,
      'ELEARNING_COURSE',
      heatmapSegmentIndex(e.currentTimestampSec),
      Math.floor(e.watchedSec),
      dropoff,
    ).catch(() => undefined);
  }
}
