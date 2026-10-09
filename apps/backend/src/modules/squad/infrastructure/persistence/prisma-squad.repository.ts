// SSOT Phase 096 §5.1 — Prisma squad repository (structural adapter)
// Canonical: apps/backend/src/modules/squad/infrastructure/persistence/prisma-squad.repository.ts
// - Point writes ride caller-owned $transactions (Gate 7); this adapter
//   only shapes rows. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { SquadMemberRow, SquadRepository, SquadRow } from '../../domain/squad.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function mapSquad(r: Record<string, unknown>): SquadRow {
  return {
    id: String(r['id']),
    tenantId: (r['tenantId'] as string | null) ?? null,
    name: String(r['name']),
    description: (r['description'] as string | null) ?? null,
    avatarUrl: (r['avatarUrl'] as string | null) ?? null,
    squadCode: String(r['squadCode']),
    maxMembers: Number(r['maxMembers']),
    totalPoints: Number(r['totalPoints']),
    isPrivate: Boolean(r['isPrivate']),
    squadLeaderId: String(r['squadLeaderId']),
  };
}

function toRepo(db: Db): SquadRepository {
  const squads = db['studySquad'];
  const members = db['squadMember'];
  return {
    async createSquad(args) {
      const row = (await squads.create({
        data: { ...args, slug: `sq-${Date.now().toString(36)}` },
      })) as unknown as Record<string, unknown>;
      await members.create({ data: { squadId: String(row['id']), userId: args.leaderId, role: 'LEADER' } });
      return mapSquad(row);
    },

    async findById(squadId: string) {
      const row = (await squads
        .findUnique({ where: { id: squadId }, include: { members: { include: { user: true } } } })
        .catch(() => null)) as unknown as (Record<string, unknown> & {
        members: Array<{ squadId: string; userId: string; role: string; pointsContributed: number; joinedAt: Date; user: { displayName: string; avatarUrl: string | null } }>;
      }) | null;
      if (!row) return null;
      return { ...mapSquad(row), members: row.members as SquadMemberRow[] };
    },

    async findByCode(squadCode: string) {
      const row = (await squads
        .findUnique({ where: { squadCode }, include: { members: { include: { user: true } } } })
        .catch(() => null)) as unknown as (Record<string, unknown> & {
        members: Array<{ squadId: string; userId: string; role: string; pointsContributed: number; joinedAt: Date; user: { displayName: string; avatarUrl: string | null } }>;
      }) | null;
      if (!row) return null;
      return { ...mapSquad(row), members: row.members as SquadMemberRow[] };
    },

    async userSquads(userId: string): Promise<SquadRow[]> {
      const rows = (await members
        .findMany({ where: { userId }, include: { squad: true }, take: 20 })
        .catch(() => [])) as unknown as Array<{ squad: Record<string, unknown> }>;
      return (rows as Array<{ squad: Record<string, unknown> }>).map((r) => mapSquad(r.squad));
    },

    async addMember(squadId: string, userId: string, role: string): Promise<void> {
      await members.create({ data: { squadId, userId, role } });
    },

    async removeMember(squadId: string, userId: string): Promise<void> {
      await members.deleteMany({ where: { squadId, userId } });
    },

    async addSquadPoints(squadId: string, points: number): Promise<void> {
      await squads.update({ where: { id: squadId }, data: { totalPoints: { increment: points } } });
    },

    async addMemberPoints(squadId: string, userId: string, points: number): Promise<void> {
      await members.update({
        where: { squadId_userId: { squadId, userId } },
        data: { pointsContributed: { increment: points } },
      });
    },

    async createChallenge(args: { squadId: string; title: string; targetPoints: number; rewardPoints: number; endDate: Date }) {
      const row = (await db['squadChallenge'].create({ data: { ...args } })) as unknown as {
        id: string; title: string; targetPoints: number; currentPoints: number; rewardPoints: number; isCompleted: boolean;
      };
      return row;
    },
  };
}

@Injectable()
export class PrismaSquadRepository implements SquadRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): SquadRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): SquadRepository {
    return toRepo(tx as Db);
  }

  createSquad(args: {
    tenantId?: string; name: string; description?: string; avatarUrl?: string;
    squadCode: string; maxMembers: number; isPrivate: boolean; leaderId: string;
  }) { return this.root.createSquad(args); }
  findById(squadId: string) { return this.root.findById(squadId); }
  findByCode(squadCode: string) { return this.root.findByCode(squadCode); }
  userSquads(userId: string) { return this.root.userSquads(userId); }
  addMember(squadId: string, userId: string, role: string) { return this.root.addMember(squadId, userId, role); }
  removeMember(squadId: string, userId: string) { return this.root.removeMember(squadId, userId); }
  addSquadPoints(squadId: string, points: number) { return this.root.addSquadPoints(squadId, points); }
  addMemberPoints(squadId: string, userId: string, points: number) { return this.root.addMemberPoints(squadId, userId, points); }
  createChallenge(args: { squadId: string; title: string; targetPoints: number; rewardPoints: number; endDate: Date }) {
    return this.root.createChallenge(args);
  }
}
