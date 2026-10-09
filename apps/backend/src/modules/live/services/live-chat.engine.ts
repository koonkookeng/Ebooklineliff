// SSOT Phase 101 BDD-1 — Chat engine (stickers + enriched broadcast)
// Canonical: apps/backend/src/modules/live/services/live-chat.engine.ts
// - send: type/content gates → PG persist (099 seam) → analytics bump →
//   enriched broadcast payload (displayName/avatar for §3.2 shape).
// - history: enriched newest-50 window (BDD-1 RAM guard).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_CHAT_WINDOW, LIVE_STREAM, liveChatWindow } from '@repo/shared';
import type { LiveRepository } from '../infrastructure/persistence/live-session.repository';
import type { LiveInteractionRepository } from '../repositories/live-interaction.repository';

export interface ChatFanOut {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

const MESSAGE_TYPES = new Set(['TEXT', 'LINE_STICKER', 'ANNOUNCEMENT', 'PRODUCT_PIN', 'SYSTEM_EVENT']);

@Injectable()
export class LiveChatEngine {
  constructor(
    private readonly sessions: LiveRepository,
    private readonly interaction: LiveInteractionRepository,
    private readonly fanout: ChatFanOut,
  ) {}

  async send(args: {
    sessionId: string;
    userId: string;
    content: string;
    messageType?: string;
    stickerPackageId?: string;
    stickerId?: string;
  }): Promise<{
    id: string; sessionId: string; userId: string; displayName: string; avatarUrl: string | null;
    messageType: string; content: string; stickerPackageId?: string; stickerId?: string; timestamp: string;
  }> {
    const messageType = args.messageType ?? (args.stickerId ? 'LINE_STICKER' : 'TEXT');
    if (!MESSAGE_TYPES.has(messageType)) throw new Error('Invalid messageType');
    const content = (args.content ?? '').slice(0, 500);
    if (!content && !args.stickerId) throw new Error('Empty chat message');
    const session = await this.sessions.findSessionById(args.sessionId).catch(() => null);
    if (!session) throw new Error('Live session not found');

    const row = await this.sessions.postChat({
      sessionId: args.sessionId,
      userId: args.userId,
      messageType,
      content,
      stickerPackageId: args.stickerPackageId,
      stickerId: args.stickerId,
    });
    await this.interaction
      .bumpAnalytics(args.sessionId, args.stickerId ? 'totalStickers' : 'totalMessages')
      .catch(() => undefined);
    // Enrich sender for the §3.2 broadcast shape (single extra read).
    const history = await this.interaction.chatWithUser(args.sessionId, 1).catch(() => []);
    const sender = history.find((h) => h.id === row.id);
    const timestamp = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
    const payload = {
      id: row.id,
      sessionId: args.sessionId,
      userId: args.userId,
      displayName: sender?.displayName ?? 'Viewer',
      avatarUrl: sender?.avatarUrl ?? null,
      messageType,
      content,
      stickerPackageId: args.stickerPackageId,
      stickerId: args.stickerId,
      timestamp,
    };
    await this.fanout
      .xaddPipeline(LIVE_STREAM, [{ event: 'live.chat', sessionId: args.sessionId, messageId: row.id, at: Date.now() }])
      .catch(() => undefined);
    return payload;
  }

  async history(sessionId: string, limit = LIVE_CHAT_WINDOW) {
    const rows = await this.interaction.chatWithUser(sessionId, Math.min(limit, LIVE_CHAT_WINDOW));
    return liveChatWindow(
      rows.map((r) => ({ ...r, timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt) })),
    );
  }
}
