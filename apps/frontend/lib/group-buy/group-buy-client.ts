// SSOT Phase 090 — Group-buy client (REST transport)
// Canonical: apps/frontend/lib/group-buy/group-buy-client.ts
// - Zero-dep (fetch only).
export type GroupBuyStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface GroupRoomMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  isCreator: boolean;
}

export interface GroupRoomDetail {
  roomId: string;
  roomCode: string;
  productId: string;
  productTitle: string;
  coverImageUrl: string;
  groupType: string;
  originalPrice: number;
  discountedPrice: number;
  requiredMembers: number;
  currentMembersCount: number;
  status: string;
  expiresAt: string;
  members: GroupRoomMember[];
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`group-buy ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function groupBuyApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    detail: (roomId: string) =>
      json<GroupRoomDetail>(`/api/v1/group-buy/detail?roomId=${encodeURIComponent(roomId)}`),
    create: (body: { productId: string; groupType: string }) =>
      post('/api/v1/group-buy/create', body) as Promise<{
        roomId: string;
        roomCode: string;
        flexMessageJson: string;
        inviteUrl: string;
        expiresAt: string;
        discountedPrice: number;
      }>,
    join: (body: { roomId: string; orderId: string }) =>
      post('/api/v1/group-buy/join', body) as Promise<{
        success: boolean;
        message: string;
        isCompleted: boolean;
        productId: string | null;
      }>,
    mine: (slug: string) =>
      json<Array<{ id: string; status: string }>>(`/api/v1/group-buy/mine?tenant=${encodeURIComponent(slug)}`),
  };
}
