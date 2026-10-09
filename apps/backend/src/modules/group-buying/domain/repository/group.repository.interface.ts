// SSOT Phase 090 §5.1 — Group repository port (DB-free tests)
// Canonical: apps/backend/src/modules/group-buying/domain/repository/group.repository.interface.ts
// - Member orderId is a plain String (slip flow binds externally).
// - Zero new deps.
export interface GroupProductRow {
  id: string;
  title: string;
  coverImageUrl: string;
  price: number;
}

export interface GroupConfigRow {
  productId: string;
  isEnabled: boolean;
  buddyPassPrice: number;
  groupBuy3pPrice: number | null;
  groupBuy5pPrice: number | null;
  timeLimitHours: number;
}

export interface GroupRoomRow {
  id: string;
  roomCode: string;
  productId: string;
  creatorId: string;
  groupType: string;
  requiredMembers: number;
  currentMembersCount: number;
  discountedPrice: number;
  status: string;
  expiresAt: Date;
}

export interface GroupRoomFull extends GroupRoomRow {
  product: GroupProductRow;
  members: Array<{
    userId: string;
    orderId: string;
    isCreator: boolean;
    joinedAt: Date;
    user: { displayName: string; avatarUrl: string | null };
  }>;
}

export interface GroupRepository {
  findProduct(productId: string): Promise<GroupProductRow | null>;
  findConfig(productId: string): Promise<GroupConfigRow | null>;
  createRoom(args: {
    productId: string;
    creatorId: string;
    groupType: string;
    requiredMembers: number;
    discountedPrice: number;
    roomCode: string;
    expiresAt: Date;
  }): Promise<GroupRoomRow>;
  addMember(args: { roomId: string; userId: string; orderId: string; isCreator: boolean }): Promise<void>;
  findById(roomId: string): Promise<GroupRoomFull | null>;
  incrementCount(roomId: string, count: number, completed: boolean): Promise<GroupRoomRow>;
  expireDue(now: Date, limit: number): Promise<GroupRoomRow[]>;
  markExpired(roomId: string): Promise<void>;
  markCancelled(roomId: string): Promise<void>;
  userRooms(userId: string): Promise<GroupRoomRow[]>;
  withTx?(tx: unknown): GroupRepository;
}
