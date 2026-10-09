// SSOT Phase 102 Task 1/6 — Lesson VOD attach service (pipeline-owned writes)
// Canonical: apps/backend/src/modules/course/lesson.service.ts
// - attachVod: videoHlsUrl + durationSec + isLiveRecorded + aiSummaryText in
//   one update (Gate 7 atomic). vodStatus: player-facing probe shape.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';

export interface LessonVodRow {
  id: string;
  title: string;
  videoHlsUrl: string;
  durationSec: number;
  isLiveRecorded: boolean;
  aiSummaryText: string | null;
}

export interface LessonVodPort {
  attachVod(lessonId: string, data: { videoHlsUrl: string; durationSec: number; aiSummaryText?: string }): Promise<LessonVodRow>;
  findLesson(lessonId: string): Promise<{ id: string; title: string } | null>;
  findVod(lessonId: string): Promise<LessonVodRow | null>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toPort(db: Db): LessonVodPort {
  const lessons = db['courseLesson'];
  return {
    async attachVod(lessonId, data) {
      const row = (await lessons.update({
        where: { id: lessonId },
        data: {
          videoHlsUrl: data.videoHlsUrl,
          durationSec: data.durationSec,
          isLiveRecorded: true,
          ...(data.aiSummaryText !== undefined ? { aiSummaryText: data.aiSummaryText } : {}),
        },
      })) as unknown as LessonVodRow;
      return row;
    },
    async findLesson(lessonId) {
      const row = (await lessons.findUnique({ where: { id: lessonId } }).catch(() => null)) as unknown as {
        id: string; title: string;
      } | null;
      return row;
    },
    async findVod(lessonId) {
      const row = (await lessons.findUnique({ where: { id: lessonId } }).catch(() => null)) as unknown as LessonVodRow | null;
      return row;
    },
  };
}

@Injectable()
export class LessonService {
  constructor(private readonly prisma: PrismaService) {}

  private get port(): LessonVodPort {
    return toPort(this.prisma as unknown as Db);
  }

  attachVod(lessonId: string, data: { videoHlsUrl: string; durationSec: number; aiSummaryText?: string }) {
    return this.port.attachVod(lessonId, data);
  }

  findLesson(lessonId: string) {
    return this.port.findLesson(lessonId);
  }

  findVod(lessonId: string) {
    return this.port.findVod(lessonId);
  }
}
