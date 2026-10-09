// SSOT Phase 101 §5.1 — Redis room fan-out adapter (horizontal scaling)
// Canonical: apps/backend/src/gateways/live-socket/adapters/redis-fanout.adapter.ts
// - Thin port over the cluster publish/subscribe pair so engines and the
//   gateway share one fan-out vocabulary. Zero new deps.
import { Injectable } from '@nestjs/common';
import { liveRoomChannel } from '@repo/shared';

export interface FanoutRedis {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
}

@Injectable()
export class RedisFanoutAdapter {
  constructor(private readonly redis: FanoutRedis) {}

  roomChannel(sessionId: string): string {
    return liveRoomChannel(sessionId);
  }

  async publishRoom(sessionId: string, event: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(this.roomChannel(sessionId), JSON.stringify({ event, payload })).catch(() => undefined);
  }

  async watchRoom(sessionId: string, handler: (event: string, payload: Record<string, unknown>) => void): Promise<() => void> {
    try {
      return await this.redis.subscribe(this.roomChannel(sessionId), (message: string) => {
        try {
          const evt = JSON.parse(message) as { event: string; payload: Record<string, unknown> };
          if (evt.event) handler(evt.event, evt.payload ?? {});
        } catch {
          // never break the subscriber loop
        }
      });
    } catch {
      return () => undefined;
    }
  }
}
