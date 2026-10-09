// SSOT Phase 099 BDD-2 — Live chat gateway (SSE fan-out, virtualized window)
// Canonical: apps/backend/src/modules/live/infrastructure/websocket/live-chat.gateway.ts
// - RISK_CALL (transport): the spec tree names a websocket gateway, but
//   socket.io is a heavy dep banned from this stack — chat rides SSE+REST
//   (057 transport precedent; 101's socket gateway untouched). Clients hold
//   one SSE stream per session; history is capped to LIVE_CHAT_WINDOW (50).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_CHAT_WINDOW, LIVE_STREAM, liveChatStreamKey, liveChatWindow } from '@repo/shared';
import type { LiveRepository } from '../persistence/live-session.repository';

export interface ChatBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface ChatSubscriber {
  write(chunk: string): void;
}

@Injectable()
export class LiveChatGateway {
  private readonly subs = new Map<string, Set<ChatSubscriber>>();

  constructor(
    private readonly repo: LiveRepository,
    private readonly bus: ChatBus,
  ) {}

  subscribe(sessionId: string, sub: ChatSubscriber): () => void {
    let set = this.subs.get(sessionId);
    if (!set) {
      set = new Set();
      this.subs.set(sessionId, set);
    }
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(sessionId);
    };
  }

  subscriberCount(sessionId: string): number {
    return this.subs.get(sessionId)?.size ?? 0;
  }

  async post(args: {
    sessionId: string;
    userId: string;
    content: string;
    messageType?: string;
    stickerPackageId?: string;
    stickerId?: string;
  }): Promise<{ messageId: string; timestamp: string }> {
    const content = args.content.slice(0, 500);
    if (!content && !args.stickerId) throw new Error('Empty chat message');
    const row = await this.repo.postChat({
      sessionId: args.sessionId,
      userId: args.userId,
      messageType: args.messageType ?? (args.stickerId ? 'LINE_STICKER' : 'TEXT'),
      content,
      stickerPackageId: args.stickerPackageId,
      stickerId: args.stickerId,
    });
    const payload = JSON.stringify({
      messageId: row.id,
      sessionId: args.sessionId,
      userId: args.userId,
      content,
      timestamp: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    });
    for (const sub of this.subs.get(args.sessionId) ?? []) {
      try {
        sub.write(`data: ${payload}\n\n`);
      } catch {
        // drop broken subscriber on next cycle
      }
    }
    await this.bus
      .xadd(liveChatStreamKey(args.sessionId), { event: 'live.chat', messageId: row.id, at: Date.now() })
      .catch(() => undefined);
    await this.bus
      .xadd(LIVE_STREAM, { event: 'live.chat', sessionId: args.sessionId, at: Date.now() })
      .catch(() => undefined);
    return {
      messageId: row.id,
      timestamp: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  async history(sessionId: string, limit = LIVE_CHAT_WINDOW) {
    const rows = await this.repo.listChat(sessionId, Math.min(limit, LIVE_CHAT_WINDOW));
    return liveChatWindow(rows);
  }
}
