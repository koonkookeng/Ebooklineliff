// SSOT Phase 046 §4.2/§5.2 — ProgressBufferService (Redis write-behind port)
// Canonical: apps/backend/src/infra/redis/progress-buffer.service.ts
// (legacy src/backend/infra/redis/progress-buffer.service.ts)
// - Thin port over RedisClusterService: progress hashes (with TTL) + heatmap
//   ZSET increments. All calls fail-open to null so the <20ms sync path
//   (Gate 7) never breaks on edge outage.
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import { heatmapKey, progressBufferKey } from '@repo/shared';

export interface ProgressEdge {
  hset(key: string, fields: Record<string, string>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  zincrby(key: string, increment: number, member: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scanKeys?(pattern: string, pageSize?: number): Promise<string[]>;
}

/** Buffer rows live 1h without a flush heartbeat (stale = flushable). */
export const PROGRESS_BUFFER_TTL_SEC = 3600;

@Injectable()
export class ProgressBufferService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly edge?: ProgressEdge) {}

  bufferKey(userId: string, lessonId: string): string {
    return progressBufferKey(userId, lessonId);
  }

  heatmapFor(lessonId: string): string {
    return heatmapKey(lessonId);
  }

  async readBuffered(userId: string, lessonId: string): Promise<Record<string, string> | null> {
    if (!this.edge) return null;
    const row = await this.edge.hgetall(this.bufferKey(userId, lessonId)).catch(() => null);
    if (!row || Object.keys(row).length === 0) return null;
    return row;
  }

  async writeBuffered(userId: string, lessonId: string, fields: Record<string, string>): Promise<void> {
    if (!this.edge) return;
    const key = this.bufferKey(userId, lessonId);
    await this.edge.hset(key, fields).catch(() => undefined);
    await this.edge.expire(key, PROGRESS_BUFFER_TTL_SEC).catch(() => undefined);
  }

  async bumpHeatmap(lessonId: string, bucket: number): Promise<void> {
    if (!this.edge) return;
    await this.edge.zincrby(this.heatmapFor(lessonId), 1, String(bucket)).catch(() => undefined);
  }

  async clearBuffered(userId: string, lessonId: string): Promise<void> {
    if (!this.edge) return;
    await this.edge.del(this.bufferKey(userId, lessonId)).catch(() => undefined);
  }

  async scanBuffered(pageSize = 200): Promise<string[]> {
    if (!this.edge || typeof this.edge.scanKeys !== 'function') return [];
    return this.edge.scanKeys('progress:buffer:*:*', pageSize).catch(() => []);
  }
}
