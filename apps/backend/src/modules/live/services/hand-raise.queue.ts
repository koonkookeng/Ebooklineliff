// SSOT Phase 101 BDD-2 — Hand-raise FIFO queue (Redis ZSET + PG ledger)
// Canonical: apps/backend/src/modules/live/services/hand-raise.queue.ts
// - request: PENDING row (idempotent per user) → ZADD score=epoch-ms →
//   position = rank+1 → analytics bump (<100ms, Gate 7).
// - resolve: APPROVED/REJECTED/COMPLETED (+ optional speak grant note) →
//   ZREM → fan-out. list: ZSET order enriched with PG rows.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_STREAM, liveRaiseQueueKey } from '@repo/shared';
import type { LiveRepository } from '../infrastructure/persistence/live-session.repository';
import type { LiveInteractionRepository, RaiseRow } from '../repositories/live-interaction.repository';
import type { ChatFanOut } from './live-chat.engine';

export interface RaiseQueueStore {
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

const TERMINAL = new Set(['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED']);

@Injectable()
export class HandRaiseQueue {
  constructor(
    private readonly sessions: LiveRepository,
    private readonly interaction: LiveInteractionRepository,
    private readonly store: RaiseQueueStore,
    private readonly fanout: ChatFanOut,
  ) {}

  async request(sessionId: string, userId: string): Promise<RaiseRow & { queuePosition: number }> {
    const session = await this.sessions.findSessionById(sessionId).catch(() => null);
    if (!session) throw new Error('Live session not found');
    if (session.status !== 'LIVE') throw new Error(`Session is ${session.status}`);
    const row = await this.interaction.requestRaise(sessionId, userId);
    const key = liveRaiseQueueKey(sessionId);
    await this.store.zadd(key, Date.now(), row.id).catch(() => undefined);
    const order = await this.store.zrange(key, 0, -1).catch(() => [] as string[]);
    const position = Math.max(1, order.indexOf(row.id) + 1);
    const placed = position !== row.queuePosition
      ? await this.interaction.setRaiseStatus(row.id, 'PENDING', position).catch(() => row)
      : row;
    await this.interaction.bumpAnalytics(sessionId, 'totalHandRaises').catch(() => undefined);
    await this.fanout
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.raise.requested', sessionId, raiseId: row.id, position, at: Date.now() }])
      .catch(() => undefined);
    return { ...placed, queuePosition: position };
  }

  async resolve(raiseId: string, status: 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED') {
    if (!TERMINAL.has(status)) throw new Error('Invalid raise status');
    const row = await this.interaction.setRaiseStatus(raiseId, status);
    await this.store.zrem(liveRaiseQueueKey(row.sessionId), raiseId).catch(() => undefined);
    await this.fanout
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.raise.resolved', sessionId: row.sessionId, raiseId, status, at: Date.now() }])
      .catch(() => undefined);
    return row;
  }

  async queue(sessionId: string) {
    const order = await this.store.zrange(liveRaiseQueueKey(sessionId), 0, -1).catch(() => [] as string[]);
    const rows = await this.interaction.listRaises(sessionId, 'PENDING').catch(() => [] as RaiseRow[]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return order
      .map((id, i) => {
        const r = byId.get(id);
        return r ? { ...r, queuePosition: i + 1 } : null;
      })
      .filter((r) => r !== null);
  }
}
