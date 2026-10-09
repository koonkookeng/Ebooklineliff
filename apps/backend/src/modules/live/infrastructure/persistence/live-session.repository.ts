// SSOT Phase 099 §5.1 — Live repository port + Prisma adapter (single seam)
// Canonical: apps/backend/src/modules/live/infrastructure/persistence/live-session.repository.ts
// - RISK_CALL: persistence/ is an extra layer vs the spec tree (which has no
//   repositories/) — single-file seam mirroring the 097/098 repository
//   pattern; use-cases stay DB-free for tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

export interface LiveSessionRow {
  id: string;
  productId: string | null;
  instructorId: string;
  title: string;
  vendor: string;
  status: string;
  streamKey: string;
  playbackArn: string | null;
  scheduledAt: Date;
  peakViewers: number;
}

export interface LiveRepository {
  createSession(data: Record<string, unknown>): Promise<LiveSessionRow>;
  findSessionById(id: string): Promise<LiveSessionRow | null>;
  setStatus(id: string, status: string, patch?: Record<string, unknown>): Promise<LiveSessionRow>;
  findEntitlement(userId: string, productId: string): Promise<{ accessGranted: boolean; expiresAt: Date | null } | null>;
  postChat(data: { sessionId: string; userId: string; messageType: string; content: string; stickerPackageId?: string; stickerId?: string }): Promise<{ id: string; createdAt: Date }>;
  listChat(sessionId: string, limit: number): Promise<Array<{ id: string; userId: string; content: string; createdAt: Date }>>;
  createPoll(data: { sessionId: string; question: string; expiresAt?: Date | null; options: string[] }): Promise<{ id: string }>;
  votePoll(data: { pollId: string; optionId: string; userId: string }): Promise<{ id: string }>;
  pollTally(pollId: string): Promise<Array<{ optionId: string; votes: number }>>;
  createVodRecord(data: { sessionId: string; storagePathR2: string; hlsMasterUrl: string; durationSec: number; fileSizeBytes: bigint }): Promise<{ id: string }>;
  findVodBySession(sessionId: string): Promise<{ id: string; hlsMasterUrl: string; storagePathR2: string } | null>;
  attachVodToLesson(lessonId: string, hlsUrl: string): Promise<void>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toRepo(db: Db): LiveRepository {
  const sessions = db['liveSession'];
  const entitlements = db['entitlement'];
  const chats = db['liveChatMessage'];
  const polls = db['livePoll'];
  const votes = db['livePollVote'];
  const vods = db['liveToVodRecord'];
  const lessons = db['courseLesson'];
  return {
    async createSession(data) {
      const row = (await sessions.create({ data })) as unknown as LiveSessionRow;
      return row;
    },
    async findSessionById(id) {
      const row = (await sessions.findUnique({ where: { id } }).catch(() => null)) as unknown as LiveSessionRow | null;
      return row;
    },
    async setStatus(id, status, patch) {
      const row = (await sessions.update({ where: { id }, data: { status, ...(patch ?? {}) } })) as unknown as LiveSessionRow;
      return row;
    },
    async findEntitlement(userId, productId) {
      const row = (await entitlements
        .findUnique({ where: { userId_productId: { userId, productId } } })
        .catch(() => null)) as unknown as { expiresAt: Date | null } | null;
      return row ? { accessGranted: true, expiresAt: row.expiresAt } : null;
    },
    async postChat(data) {
      const row = (await chats.create({ data })) as unknown as { id: string; createdAt: Date };
      return { id: row.id, createdAt: row.createdAt };
    },
    async listChat(sessionId, limit) {
      const rows = (await chats
        .findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: limit })
        .catch(() => [])) as unknown as Array<{ id: string; userId: string; content: string; createdAt: Date }>;
      return rows.reverse();
    },
    async createPoll(data) {
      const row = (await polls.create({
        data: {
          sessionId: data.sessionId,
          question: data.question,
          expiresAt: data.expiresAt,
          options: { create: data.options.map((text) => ({ text })) },
        },
      })) as unknown as { id: string };
      return { id: row.id };
    },
    async votePoll(data) {
      const row = (await votes.upsert({
        where: { pollId_userId: { pollId: data.pollId, userId: data.userId } },
        update: { optionId: data.optionId },
        create: { ...data },
      })) as unknown as { id: string };
      return { id: row.id };
    },
    async pollTally(pollId) {
      const rows = (await votes.findMany({ where: { pollId } }).catch(() => [])) as unknown as Array<{ optionId: string }>;
      const tally = new Map<string, number>();
      for (const r of rows) tally.set(r.optionId, (tally.get(r.optionId) ?? 0) + 1);
      return [...tally.entries()].map(([optionId, voteCount]) => ({ optionId, votes: voteCount }));
    },
    async createVodRecord(data) {
      const row = (await vods.create({ data })) as unknown as { id: string };
      return { id: row.id };
    },
    async findVodBySession(sessionId: string) {
      const row = (await vods.findUnique({ where: { sessionId } }).catch(() => null)) as unknown as {
        id: string; hlsMasterUrl: string; storagePathR2: string;
      } | null;
      return row;
    },
    async attachVodToLesson(lessonId, hlsUrl) {
      await lessons.update({ where: { id: lessonId }, data: { videoHlsUrl: hlsUrl } }).catch(() => null);
    },
  };
}

@Injectable()
export class PrismaLiveRepository implements LiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): LiveRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  createSession(data: Record<string, unknown>) { return this.root.createSession(data); }
  findSessionById(id: string) { return this.root.findSessionById(id); }
  setStatus(id: string, status: string, patch?: Record<string, unknown>) { return this.root.setStatus(id, status, patch); }
  findEntitlement(userId: string, productId: string) { return this.root.findEntitlement(userId, productId); }
  postChat(data: { sessionId: string; userId: string; messageType: string; content: string; stickerPackageId?: string; stickerId?: string }) {
    return this.root.postChat(data);
  }
  listChat(sessionId: string, limit: number) { return this.root.listChat(sessionId, limit); }
  createPoll(data: { sessionId: string; question: string; expiresAt?: Date | null; options: string[] }) {
    return this.root.createPoll(data);
  }
  votePoll(data: { pollId: string; optionId: string; userId: string }) { return this.root.votePoll(data); }
  pollTally(pollId: string) { return this.root.pollTally(pollId); }
  createVodRecord(data: { sessionId: string; storagePathR2: string; hlsMasterUrl: string; durationSec: number; fileSizeBytes: bigint }) {
    return this.root.createVodRecord(data);
  }
  findVodBySession(sessionId: string) { return this.root.findVodBySession(sessionId); }
  attachVodToLesson(lessonId: string, hlsUrl: string) { return this.root.attachVodToLesson(lessonId, hlsUrl); }
}
