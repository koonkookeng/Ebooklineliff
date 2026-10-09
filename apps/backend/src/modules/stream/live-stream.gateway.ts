// SSOT Phase 100 Task 4 — Kick fan-out gateway (SSE + Redis pub/sub)
// Canonical: apps/backend/src/modules/stream/live-stream.gateway.ts
// - RISK_CALL (transport): the spec's WS namespace is replaced with
//   SSE per-viewer streams (099/057 precedent — WS libs are banned heavy
//   deps). kick(roomId,userId) fans out locally (<2s, BDD-2) AND publishes on
//   LIVE_KICK_CHANNEL for sibling instances; attach() subscribes once.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { LIVE_KICK_CHANNEL, liveKickStreamKey } from '@repo/shared';

export interface KickSubscriber {
  write(chunk: string): void;
}

export interface KickBus {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface KickPubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
}

@Injectable()
export class LiveStreamGateway implements OnModuleInit {
  private readonly subs = new Map<string, Set<KickSubscriber>>();
  private attached = false;

  constructor(
    private readonly bus: KickBus,
    private readonly pubsub: KickPubSub,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.attach();
  }

  async attach(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
    await this.pubsub.subscribe(LIVE_KICK_CHANNEL, (message: string) => {
      try {
        const evt = JSON.parse(message) as { roomId: string; userId: string; reason: string; actionTimestamp?: string };
        if (evt.roomId && evt.userId) void this.emitKick(evt.roomId, evt.userId, evt.reason ?? 'REVOKED');
      } catch {
        // never break the subscriber loop
      }
    }).catch(() => undefined);
  }

  subscribe(liveRoomId: string, userId: string, sub: KickSubscriber): () => void {
    const key = liveKickStreamKey(liveRoomId, userId);
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(key);
    };
  }

  async emitKick(liveRoomId: string, userId: string, reason: string): Promise<number> {
    const payload = JSON.stringify({ reason, timestamp: new Date().toISOString() });
    const set = this.subs.get(liveKickStreamKey(liveRoomId, userId));
    let n = 0;
    for (const sub of set ?? []) {
      try {
        sub.write(`event: LIVE_SESSION_KICK\ndata: ${payload}\n\n`);
        n++;
      } catch {
        // drop on next cycle
      }
    }
    await this.bus
      .xaddPipeline(liveKickStreamKey(liveRoomId, userId), [{ event: 'LIVE_SESSION_KICK', reason, at: Date.now() }])
      .catch(() => undefined);
    return n;
  }
}
