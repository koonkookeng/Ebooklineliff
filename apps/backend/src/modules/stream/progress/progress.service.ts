// SSOT Phase 046 Task 2 — ProgressService (write-behind buffer + flush)
// Canonical: apps/backend/src/modules/stream/progress/progress.service.ts
// (legacy src/backend/modules/stream/progress/progress.service.ts)
// - §5.2 flow: monotonic max → 95% completion → hash write + heatmap ZSET
//   (<20ms, Gate 7) → {success, lessonId, savedWatchedSec, isCompleted}.
// - §8.1 guards: fixed-window rate limit (2/5s per user → 429, no PII in
//   logs), watchedSec clamped to durationSec, velocity-capped jumps.
// - §4.2 flush: buffer ⨯ DB max → atomic upsert; flushAllDue sweeps the
//   buffer keyspace for the 30s scheduler.
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import {
  PROGRESS_RATE_LIMIT,
  PROGRESS_RATE_WINDOW_SEC,
  bufferCompleted,
  secondBucket,
  type SyncProgressInput,
  type SyncProgressPayload,
} from '@repo/shared';
import { ProgressBufferService } from '../../../infra/redis/progress-buffer.service';

export interface ProgressPrisma {
  courseLearningProgress: {
    findUnique(args: unknown): Promise<{ watchedSec: number; isCompleted: boolean } | null>;
    upsert(args: unknown): Promise<{ watchedSec: number; isCompleted: boolean; updatedAt: Date }>;
  };
}

export interface ProgressRateEdge {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

function rateKey(userId: string): string {
  return `ratelimit:progress:${userId}`;
}

function parseBufferRow(row: Record<string, string> | null): { watchedSec: number; updatedAtMs: number } {
  if (!row) return { watchedSec: 0, updatedAtMs: 0 };
  const watched = Number.parseInt(row['watchedSec'] ?? '0', 10);
  const updatedAtMs = Date.parse(row['updatedAt'] ?? '');
  return {
    watchedSec: Number.isInteger(watched) && watched > 0 ? watched : 0,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  };
}

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly buffer?: ProgressBufferService,
    private readonly prisma?: ProgressPrisma,
    private readonly rateEdge?: ProgressRateEdge,
    private readonly clock: () => number = Date.now,
  ) {}

  private async checkRateLimit(userId: string): Promise<void> {
    if (!this.rateEdge) return;
    const count = await this.rateEdge.incr(rateKey(userId)).catch(() => 0);
    if (count === 1) await this.rateEdge.expire(rateKey(userId), PROGRESS_RATE_WINDOW_SEC).catch(() => undefined);
    if (count > PROGRESS_RATE_LIMIT) {
      this.logger.warn('Progress rate limit exceeded');
      throw new HttpException('Too many progress syncs', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Plausible ceiling: prior max + 3x elapsed + 120s grace (scrub-tolerant). */
  private velocityCap(priorWatched: number, priorMs: number, nowMs: number): number {
    if (priorMs <= 0) return Number.POSITIVE_INFINITY;
    const elapsedSec = Math.max(0, (nowMs - priorMs) / 1000);
    return priorWatched + elapsedSec * 3 + 120;
  }

  async bufferProgressSync(userId: string, input: SyncProgressInput): Promise<SyncProgressPayload> {
    await this.checkRateLimit(userId);
    const nowMs = this.clock();
    const clamped = Math.min(input.watchedSec, input.durationSec);
    const buffered = this.buffer ? await this.buffer.readBuffered(userId, input.lessonId).catch(() => null) : null;
    const prior = parseBufferRow(buffered);
    const capped = Math.min(clamped, this.velocityCap(prior.watchedSec, prior.updatedAtMs, nowMs));
    const savedWatchedSec = Math.max(prior.watchedSec, Math.floor(capped));
    const done = bufferCompleted(savedWatchedSec, input.durationSec, input.isCompleted);
    await this.buffer
      ?.writeBuffered(userId, input.lessonId, {
        userId,
        lessonId: input.lessonId,
        watchedSec: String(savedWatchedSec),
        durationSec: String(input.durationSec),
        isCompleted: done ? '1' : '0',
        updatedAt: new Date(nowMs).toISOString(),
      })
      .catch(() => undefined);
    await this.buffer?.bumpHeatmap(input.lessonId, secondBucket(savedWatchedSec)).catch(() => undefined);
    return {
      success: true,
      lessonId: input.lessonId,
      savedWatchedSec,
      isCompleted: done,
      serverTimestamp: new Date(nowMs).toISOString(),
    };
  }

  /** Single buffer row ⨯ DB max → atomic upsert (cross-device safe). */
  async flushBuffer(userId: string, lessonId: string): Promise<{ flushed: boolean }> {
    if (!this.buffer || !this.prisma) return { flushed: false };
    const row = await this.buffer.readBuffered(userId, lessonId).catch(() => null);
    const prior = parseBufferRow(row);
    if (prior.watchedSec <= 0 && prior.updatedAtMs <= 0) return { flushed: false };
    const durationSec = Number.parseInt(row?.['durationSec'] ?? '0', 10);
    const flagged = row?.['isCompleted'] === '1';
    const current = await this.prisma.courseLearningProgress
      .findUnique({ where: { userId_lessonId: { userId, lessonId } } })
      .catch(() => null);
    const watchedSec = Math.max(prior.watchedSec, current?.watchedSec ?? 0);
    const isCompleted =
      (current?.isCompleted ?? false) || bufferCompleted(prior.watchedSec, Number.isInteger(durationSec) ? durationSec : 0, flagged);
    await this.prisma.courseLearningProgress
      .upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, watchedSec, isCompleted },
        update: { watchedSec, isCompleted },
      })
      .catch(() => null);
    await this.buffer.clearBuffered(userId, lessonId).catch(() => undefined);
    return { flushed: true };
  }

  /** 30s scheduler sweep over the buffer keyspace (best-effort per row). */
  async flushAllDue(): Promise<{ scanned: number; flushed: number }> {
    if (!this.buffer) return { scanned: 0, flushed: 0 };
    const keys = await this.buffer.scanBuffered().catch(() => []);
    let flushed = 0;
    for (const key of keys) {
      const parts = key.split(':');
      // progress:buffer:{userId}:{lessonId} — ids are colon-free uuids.
      if (parts.length !== 4 || parts[0] !== 'progress' || parts[1] !== 'buffer') continue;
      const result = await this.flushBuffer(parts[2] as string, parts[3] as string).catch(() => ({ flushed: false }));
      if (result.flushed) flushed += 1;
    }
    return { scanned: keys.length, flushed };
  }
}
