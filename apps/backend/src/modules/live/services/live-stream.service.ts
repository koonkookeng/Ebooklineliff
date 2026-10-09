// SSOT Phase 101 §5.1 — Live stream service (sessions + viewer counter)
// Canonical: apps/backend/src/modules/live/services/live-stream.service.ts
// - createSession (SCHEDULED row + streamKey) + viewer join/leave (Redis
//   atomic counters, peak persisted to LiveAnalytics).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_STREAM, liveViewerKey } from '@repo/shared';
import type { LiveRepository } from '../infrastructure/persistence/live-session.repository';
import type { LiveInteractionRepository } from '../repositories/live-interaction.repository';

export interface StreamCounter {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class LiveStreamService {
  constructor(
    private readonly sessions: LiveRepository,
    private readonly interaction: LiveInteractionRepository,
    private readonly counters: StreamCounter,
  ) {}

  async createSession(args: {
    productId?: string;
    instructorId: string;
    title: string;
    description?: string;
    coverImageUrl?: string;
    vendor?: string;
    scheduledAt: Date;
    streamKey: string;
  }) {
    return this.sessions.createSession({
      productId: args.productId,
      instructorId: args.instructorId,
      title: args.title,
      description: args.description ?? '',
      coverImageUrl: args.coverImageUrl ?? '',
      vendor: args.vendor ?? 'AMAZON_IVS',
      status: 'SCHEDULED',
      streamKey: args.streamKey,
      scheduledAt: args.scheduledAt,
    });
  }

  async viewerJoin(sessionId: string): Promise<{ count: number }> {
    const count = await this.counters.incr(liveViewerKey(sessionId)).catch(() => 1);
    const current = await this.interaction.readAnalytics(sessionId).catch(() => null);
    if (!current || count > current.peakViewers) {
      await this.interaction.touchPeak(sessionId, count).catch(() => undefined);
    }
    await this.counters
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.viewers', sessionId, count, at: Date.now() }])
      .catch(() => undefined);
    return { count };
  }

  async viewerLeave(sessionId: string): Promise<{ count: number }> {
    const count = Math.max(0, (await this.counters.decr(liveViewerKey(sessionId)).catch(() => 0)));
    await this.counters
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.viewers', sessionId, count, at: Date.now() }])
      .catch(() => undefined);
    return { count };
  }
}
