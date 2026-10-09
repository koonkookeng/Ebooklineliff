// SSOT Phase 102 Task 1 — TranscodeJob ledger port + Prisma adapter
// Canonical: apps/backend/src/modules/stream/application/vod-job.repository.ts
// - Single-file seam (097 pattern): idempotent upsert per session, progress
//   flips, terminal states. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import type { VodJobLedger } from './live-to-vod.service';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toLedger(db: Db): VodJobLedger {
  const jobs = db['transcodeJob'];
  return {
    async upsertJob(data) {
      const existing = (await jobs.findUnique({ where: { liveSessionId: data.liveSessionId } }).catch(() => null)) as unknown as {
        id: string; progressPct: number;
      } | null;
      if (existing) return existing;
      const row = (await jobs.create({
        data: { liveSessionId: data.liveSessionId, lessonId: data.lessonId, progressPct: 0 },
      })) as unknown as { id: string; progressPct: number };
      return row;
    },
    async setProgress(liveSessionId, progressPct) {
      await jobs.update({ where: { liveSessionId }, data: { progressPct } }).catch(() => null);
    },
    async completeJob(liveSessionId, data) {
      await jobs
        .update({
          where: { liveSessionId },
          data: { progressPct: 100, hlsManifestPath: data.hlsManifestPath, durationSec: data.durationSec, completedAt: new Date(), errorMessage: null },
        })
        .catch(() => null);
    },
    async failJob(liveSessionId, errorMessage) {
      await jobs.update({ where: { liveSessionId }, data: { errorMessage } }).catch(() => null);
    },
    async findJobBySession(liveSessionId) {
      const row = (await jobs.findUnique({ where: { liveSessionId } }).catch(() => null)) as unknown as {
        id: string; lessonId: string; progressPct: number; hlsManifestPath: string | null; errorMessage: string | null;
      } | null;
      return row;
    },
  };
}

@Injectable()
export class PrismaVodJobRepository implements VodJobLedger {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): VodJobLedger {
    return toLedger(this.prisma as unknown as Db);
  }

  upsertJob(data: { liveSessionId: string; lessonId: string }) { return this.root.upsertJob(data); }
  setProgress(liveSessionId: string, progressPct: number) { return this.root.setProgress(liveSessionId, progressPct); }
  completeJob(liveSessionId: string, data: { hlsManifestPath: string; durationSec: number }) {
    return this.root.completeJob(liveSessionId, data);
  }
  failJob(liveSessionId: string, errorMessage: string) { return this.root.failJob(liveSessionId, errorMessage); }
  findJobBySession(liveSessionId: string) { return this.root.findJobBySession(liveSessionId); }
}
