// SSOT Phase 096 — Squad + leaderboard client (REST transport)
// Canonical: apps/frontend/lib/squad/squad-client.ts
// - Zero-dep (fetch only).
export type SquadStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface SquadMember {
  userId: string;
  displayName: string;
  role: string;
  pointsContributed: number;
  joinedAt: string;
}

export interface SquadDetail {
  id: string;
  name: string;
  description: string | null;
  squadCode: string;
  totalPoints: number;
  memberCount: number;
  maxMembers: number;
  members: SquadMember[];
}

export interface BoardEntry {
  rank: number;
  entityId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  isCurrentUser: boolean;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`squad ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function squadApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    create: (body: { name: string; description?: string; maxMembers?: number; isPrivate?: boolean }) =>
      post('/api/v1/squads/create', body) as Promise<{
        squadId: string; squadCode: string; flexMessageJson: string; inviteUrl: string;
      }>,
    join: (body: { squadCode?: string; squadId?: string }) =>
      post('/api/v1/squads/join', body) as Promise<{ squadId: string; memberCount: number }>,
    mine: () => json<Array<{ id: string; name: string }>>('/api/v1/squads/mine'),
    detail: (squadId: string) =>
      json<SquadDetail>(`/api/v1/squads/detail?squadId=${encodeURIComponent(squadId)}`),
    claim: (body: { activityType: string; referenceId: string; dwellTimeSec: number; signatureNonce: string; squadId?: string }) =>
      post('/api/v1/points/claim', body) as Promise<{ pointsEarned: number; newTotalPoints: number; squadBonusEarned: number }>,
    board: (scope: string, timeframe: string, limit = 50) =>
      json<BoardEntry[]>(
        `/api/v1/leaderboard?scope=${encodeURIComponent(scope)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
      ),
  };
}
