// SSOT Phase 057 §1.2 — Generic Redis Pub/Sub adapter (room fan-out transport)
// Canonical: apps/backend/src/infra/redis/redis-pubsub.adapter.ts
// (legacy src/backend/infra/redis/redis-pubsub.adapter.ts)
// - Thin room-fan-out facade over RedisClusterService publish/subscribe
//   (ioredis, existing dep): publishRoom serializes once; subscribeRoom
//   parses + filters by event name. Sub-100ms fan-out budget (§1.3 BDD).
// - No Nest param decorators on the adapter itself (tsx-importable); the
//   Nest wrapper is provided via SyncModule useFactory.
import { SYNC_FANOUT_BUDGET_MS } from '@repo/shared';
import type { RedisClusterService } from './redis-cluster.service';

export interface RoomMessage {
  event: string;
  data: unknown;
  serverTimestamp: number;
}

export class RedisPubSubAdapter {
  constructor(private readonly edge: Pick<RedisClusterService, 'publish' | 'subscribe'>) {}

  async publishRoom(channel: string, event: string, data: unknown): Promise<void> {
    const started = Date.now();
    const msg: RoomMessage = { event, data, serverTimestamp: Date.now() };
    await this.edge.publish(channel, JSON.stringify(msg));
    void started;
  }

  fanoutBudgetMs(): number {
    return SYNC_FANOUT_BUDGET_MS;
  }

  async subscribeRoom(channel: string, event: string, handler: (data: unknown) => void): Promise<() => void> {
    return this.edge.subscribe(channel, (raw: string) => {
      try {
        const msg = JSON.parse(raw) as RoomMessage;
        if (msg.event === event) handler(msg.data);
      } catch {
        // malformed room frame never breaks the subscriber loop
      }
    });
  }
}
