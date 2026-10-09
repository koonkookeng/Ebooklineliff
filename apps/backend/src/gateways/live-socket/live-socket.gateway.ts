// SSOT Phase 101 §5.2 — Live interaction socket gateway (SSE hub)
// Canonical: apps/backend/src/gateways/live-socket/live-socket.gateway.ts
// - RISK_CALL (transport): the spec's WS namespace is an SSE hub (099/100
//   precedent — WS libs are banned heavy deps). Handshake verifies the 100
//   gatekeeper playback token; viewers join the room fan-out; viewer count
//   rides atomic Redis counters; chat/poll/raise events fan out locally AND
//   publish on the room channel for sibling instances (attach() once).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { LIVE_STREAM, liveRoomChannel, liveViewerKey } from '@repo/shared';

export interface RoomSubscriber {
  write(chunk: string): void;
}

export interface RoomBus {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
}

export interface RoomPubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
}

export interface TokenVerifier {
  verifyToken(token: string): { liveRoomId: string; userId: string } | null;
}

@Injectable()
export class LiveSocketGateway implements OnModuleInit {
  private readonly subs = new Map<string, Set<RoomSubscriber>>();
  private attached = false;

  constructor(
    private readonly bus: RoomBus,
    private readonly pubsub: RoomPubSub,
    private readonly verifier: TokenVerifier,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.attach();
  }

  async attach(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
  }

  /** Subscribe once per active room: sibling-instance events re-emit locally. */
  private readonly roomWatches = new Set<string>();

  private async ensureRoom(sessionId: string): Promise<void> {
    if (this.roomWatches.has(sessionId)) return;
    this.roomWatches.add(sessionId);
    await this.pubsub.subscribe(liveRoomChannel(sessionId), (message: string) => {
      try {
        const evt = JSON.parse(message) as { event: string; payload: Record<string, unknown> };
        if (evt.event) void this.emitLocal(sessionId, evt.event, evt.payload ?? {});
      } catch {
        // never break the subscriber loop
      }
    }).catch(() => undefined);
  }

  /** Handshake: 100-gatekeeper token → { userId } or null (fail-closed). */
  handshake(sessionId: string, token: string): string | null {
    if (!sessionId || !token) return null;
    const v = this.verifier.verifyToken(token);
    if (!v) return null;
    return v.userId;
  }

  subscribe(sessionId: string, sub: RoomSubscriber): () => void {
    let set = this.subs.get(sessionId);
    if (!set) {
      set = new Set();
      this.subs.set(sessionId, set);
    }
    set.add(sub);
    void this.ensureRoom(sessionId);
    void this.viewerJoin(sessionId);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(sessionId);
      void this.viewerLeave(sessionId);
    };
  }

  async broadcast(sessionId: string, event: string, payload: unknown): Promise<number> {
    const n = await this.emitLocal(sessionId, event, payload);
    await this.pubsub.publish(liveRoomChannel(sessionId), JSON.stringify({ event, payload })).catch(() => undefined);
    return n;
  }

  private async emitLocal(sessionId: string, event: string, payload: unknown): Promise<number> {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    let n = 0;
    for (const sub of this.subs.get(sessionId) ?? []) {
      try {
        sub.write(frame);
        n++;
      } catch {
        // drop on next cycle
      }
    }
    return n;
  }

  async viewerJoin(sessionId: string): Promise<number> {
    const count = await this.bus.incr(liveViewerKey(sessionId)).catch(() => 1);
    await this.bus
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.viewers', sessionId, count, at: Date.now() }])
      .catch(() => undefined);
    return count;
  }

  async viewerLeave(sessionId: string): Promise<number> {
    const count = Math.max(0, await this.bus.decr(liveViewerKey(sessionId)).catch(() => 0));
    await this.bus
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.viewers', sessionId, count, at: Date.now() }])
      .catch(() => undefined);
    return count;
  }
}
