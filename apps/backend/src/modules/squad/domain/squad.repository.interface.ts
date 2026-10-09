// SSOT Phase 096 — Squad repository port (DB-free tests)
// Canonical: apps/backend/src/modules/squad/domain/squad.repository.interface.ts
// - Zero new deps.
export interface SquadRow {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  squadCode: string;
  maxMembers: number;
  totalPoints: number;
  isPrivate: boolean;
  squadLeaderId: string;
}

export interface SquadMemberRow {
  squadId: string;
  userId: string;
  role: string;
  pointsContributed: number;
  joinedAt: Date;
  user: { displayName: string; avatarUrl: string | null };
}

export interface SquadRepository {
  createSquad(args: {
    tenantId?: string;
    name: string;
    description?: string;
    avatarUrl?: string;
    squadCode: string;
    maxMembers: number;
    isPrivate: boolean;
    leaderId: string;
  }): Promise<SquadRow>;
  findById(squadId: string): Promise<(SquadRow & { members: SquadMemberRow[] }) | null>;
  findByCode(squadCode: string): Promise<(SquadRow & { members: SquadMemberRow[] }) | null>;
  userSquads(userId: string): Promise<SquadRow[]>;
  addMember(squadId: string, userId: string, role: string): Promise<void>;
  removeMember(squadId: string, userId: string): Promise<void>;
  addSquadPoints(squadId: string, points: number): Promise<void>;
  addMemberPoints(squadId: string, userId: string, points: number): Promise<void>;
  createChallenge(args: { squadId: string; title: string; targetPoints: number; rewardPoints: number; endDate: Date }): Promise<{
    id: string; title: string; targetPoints: number; currentPoints: number; rewardPoints: number; isCompleted: boolean;
  }>;
  withTx?(tx: unknown): SquadRepository;
}
