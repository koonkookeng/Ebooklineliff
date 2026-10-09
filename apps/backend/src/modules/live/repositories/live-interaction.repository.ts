// SSOT Phase 101 §5.1 — Interaction repository port + Prisma adapter
// Canonical: apps/backend/src/modules/live/repositories/live-interaction.repository.ts
// - Hand-raise ledger + analytics counters + enriched chat/poll reads.
//   Single-file seam (097/098 pattern); engines stay DB-free for tests.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface RaiseRow {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  status: string;
  queuePosition: number;
  createdAt: Date;
}

export interface AnalyticsRow {
  sessionId: string;
  peakViewers: number;
  totalMessages: number;
  totalStickers: number;
  totalHandRaises: number;
  totalPollVotes: number;
  avgWatchSec: number;
}

export interface LiveInteractionRepository {
  requestRaise(sessionId: string, userId: string): Promise<RaiseRow>;
  setRaiseStatus(id: string, status: string, queuePosition?: number): Promise<RaiseRow>;
  listRaises(sessionId: string, status?: string): Promise<RaiseRow[]>;
  bumpAnalytics(sessionId: string, field: 'totalMessages' | 'totalStickers' | 'totalHandRaises' | 'totalPollVotes', peakViewers?: number): Promise<void>;
  readAnalytics(sessionId: string): Promise<AnalyticsRow | null>;
  touchPeak(sessionId: string, peakViewers: number): Promise<void>;
  chatWithUser(sessionId: string, limit: number): Promise<Array<{
    id: string; sessionId: string; userId: string; displayName: string; avatarUrl: string | null;
    messageType: string; content: string; stickerPackageId: string | null; stickerId: string | null; createdAt: Date;
  }>>;
  pollDetail(pollId: string): Promise<{
    id: string; sessionId: string; question: string; isActive: boolean; expiresAt: Date | null;
    options: Array<{ id: string; text: string }>;
    votes: Array<{ optionId: string; userId: string }>;
  } | null>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): LiveInteractionRepository {
  const raises = db['liveHandRaise'];
  const analytics = db['liveAnalytics'];
  const chats = db['liveChatMessage'];
  const polls = db['livePoll'];
  return {
    async requestRaise(sessionId, userId) {
      const existing = (await raises
        .findFirst({ where: { sessionId, userId, status: 'PENDING' } })
        .catch(() => null)) as unknown as { id: string } | null;
      if (existing) {
        const row = (await raises.findUnique({
          where: { id: existing.id },
          include: { user: { select: { displayName: true } } },
        })) as unknown as Record<string, unknown>;
        return mapRaise(row);
      }
      const row = (await raises.create({
        data: { sessionId, userId, status: 'PENDING' },
        include: { user: { select: { displayName: true } } },
      })) as unknown as Record<string, unknown>;
      return mapRaise(row);
    },
    async setRaiseStatus(id, status, queuePosition) {
      const row = (await raises.update({
        where: { id },
        data: { status, ...(queuePosition !== undefined ? { queuePosition } : {}) },
        include: { user: { select: { displayName: true } } },
      })) as unknown as Record<string, unknown>;
      return mapRaise(row);
    },
    async listRaises(sessionId, status) {
      const rows = (await raises
        .findMany({
          where: { sessionId, ...(status ? { status } : {}) },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        })
        .catch(() => [])) as unknown as Array<Record<string, unknown>>;
      return rows.map(mapRaise);
    },
    async bumpAnalytics(sessionId, field, peakViewers) {
      await analytics.upsert({
        where: { sessionId },
        update: { [field]: { increment: 1 }, ...(peakViewers !== undefined ? { peakViewers } : {}) },
        create: { sessionId, [field]: 1, ...(peakViewers !== undefined ? { peakViewers } : {}) },
      }).catch(() => undefined);
    },
    async readAnalytics(sessionId) {
      const row = (await analytics.findUnique({ where: { sessionId } }).catch(() => null)) as unknown as AnalyticsRow | null;
      return row;
    },
    async touchPeak(sessionId, peakViewers) {
      await analytics.upsert({
        where: { sessionId },
        update: { peakViewers },
        create: { sessionId, peakViewers },
      }).catch(() => undefined);
    },
    async chatWithUser(sessionId, limit) {
      const rows = (await chats
        .findMany({
          where: { sessionId },
          include: { user: { select: { displayName: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        .catch(() => [])) as unknown as Array<Record<string, unknown>>;
      return rows.reverse().map((r) => {
        const user = (r['user'] as { displayName?: string; avatarUrl?: string | null } | null) ?? {};
        return {
          id: r['id'] as string,
          sessionId: r['sessionId'] as string,
          userId: r['userId'] as string,
          displayName: user.displayName ?? 'Viewer',
          avatarUrl: user.avatarUrl ?? null,
          messageType: r['messageType'] as string,
          content: r['content'] as string,
          stickerPackageId: (r['stickerPackageId'] as string | null) ?? null,
          stickerId: (r['stickerId'] as string | null) ?? null,
          createdAt: r['createdAt'] as Date,
        };
      });
    },
    async pollDetail(pollId) {
      const row = (await polls
        .findUnique({ where: { id: pollId }, include: { options: true, votes: true } })
        .catch(() => null)) as unknown as {
          id: string; sessionId: string; question: string; isActive: boolean; expiresAt: Date | null;
          options: Array<{ id: string; text: string }>;
          votes: Array<{ optionId: string; userId: string }>;
        } | null;
      return row;
    },
  };
}

function mapRaise(row: Record<string, unknown>): RaiseRow {
  const user = (row['user'] as { displayName?: string } | null) ?? {};
  return {
    id: row['id'] as string,
    sessionId: row['sessionId'] as string,
    userId: row['userId'] as string,
    displayName: user.displayName ?? 'Student',
    status: row['status'] as string,
    queuePosition: (row['queuePosition'] as number) ?? 0,
    createdAt: row['createdAt'] as Date,
  };
}

@Injectable()
export class PrismaLiveInteractionRepository implements LiveInteractionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): LiveInteractionRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  requestRaise(sessionId: string, userId: string) { return this.root.requestRaise(sessionId, userId); }
  setRaiseStatus(id: string, status: string, queuePosition?: number) { return this.root.setRaiseStatus(id, status, queuePosition); }
  listRaises(sessionId: string, status?: string) { return this.root.listRaises(sessionId, status); }
  bumpAnalytics(sessionId: string, field: 'totalMessages' | 'totalStickers' | 'totalHandRaises' | 'totalPollVotes', peakViewers?: number) {
    return this.root.bumpAnalytics(sessionId, field, peakViewers);
  }
  readAnalytics(sessionId: string) { return this.root.readAnalytics(sessionId); }
  touchPeak(sessionId: string, peakViewers: number) { return this.root.touchPeak(sessionId, peakViewers); }
  chatWithUser(sessionId: string, limit: number) { return this.root.chatWithUser(sessionId, limit); }
  pollDetail(pollId: string) { return this.root.pollDetail(pollId); }
}
