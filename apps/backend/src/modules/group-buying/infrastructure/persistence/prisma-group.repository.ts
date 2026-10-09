// SSOT Phase 090 §5.1 — Prisma group repository (structural adapter)
// Canonical: apps/backend/src/modules/group-buying/infrastructure/persistence/prisma-group.repository.ts
// - Join/expiry mutations run inside caller-owned $transactions (Gate 7);
//   this adapter only shapes rows. Entitlement writes ride the same txn via
//   the injected 012 grant service (no duplicate grant code).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type {
  GroupConfigRow,
  GroupProductRow,
  GroupRepository,
  GroupRoomFull,
  GroupRoomRow,
} from '../../domain/repository/group.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => (typeof v === 'object' && v !== null && 'toNumber' in (v as object) ? Number((v as { toNumber(): number }).toNumber()) : Number(v));

function mapRoom(r: Record<string, unknown>): GroupRoomRow {
  return {
    id: String(r['id']),
    roomCode: String(r['roomCode']),
    productId: String(r['productId']),
    creatorId: String(r['creatorId']),
    groupType: String(r['groupType']),
    requiredMembers: Number(r['requiredMembers']),
    currentMembersCount: Number(r['currentMembersCount']),
    discountedPrice: toNum(r['discountedPrice']),
    status: String(r['status']),
    expiresAt: r['expiresAt'] as Date,
  };
}

function toRepo(db: Db): GroupRepository {
  return {
    async findProduct(productId: string): Promise<GroupProductRow | null> {
      const p = (await db['product'].findUnique({ where: { id: productId } }).catch(() => null)) as {
        id: string; title: string; coverImageUrl: string; price: unknown;
      } | null;
      if (!p) return null;
      return { id: p.id, title: p.title, coverImageUrl: p.coverImageUrl, price: toNum(p.price) };
    },

    async findConfig(productId: string): Promise<GroupConfigRow | null> {
      const c = (await db['groupBuyingConfig'].findUnique({ where: { productId } }).catch(() => null)) as {
        productId: string; isEnabled: boolean; buddyPassPrice: unknown;
        groupBuy3pPrice: unknown | null; groupBuy5pPrice: unknown | null; timeLimitHours: number;
      } | null;
      if (!c) return null;
      return {
        productId: c.productId,
        isEnabled: c.isEnabled,
        buddyPassPrice: toNum(c.buddyPassPrice),
        groupBuy3pPrice: c.groupBuy3pPrice == null ? null : toNum(c.groupBuy3pPrice),
        groupBuy5pPrice: c.groupBuy5pPrice == null ? null : toNum(c.groupBuy5pPrice),
        timeLimitHours: c.timeLimitHours,
      };
    },

    async createRoom(args): Promise<GroupRoomRow> {
      return mapRoom((await db['groupBuyingRoom'].create({ data: { ...args } })) as Record<string, unknown>);
    },

    async addMember(args: { roomId: string; userId: string; orderId: string; isCreator: boolean }): Promise<void> {
      await db['groupBuyingMember'].create({ data: { ...args } });
    },

    async findById(roomId: string): Promise<GroupRoomFull | null> {
      const row = (await db['groupBuyingRoom'].findUnique({
        where: { id: roomId },
        include: { product: true, members: { include: { user: true } } },
      }).catch(() => null)) as (Record<string, unknown> & {
        product: { id: string; title: string; coverImageUrl: string; price: unknown };
        members: Array<{ userId: string; orderId: string; isCreator: boolean; joinedAt: Date; user: { displayName: string; avatarUrl: string | null } }>;
      }) | null;
      if (!row) return null;
      return {
        ...mapRoom(row),
        product: { id: row.product.id, title: row.product.title, coverImageUrl: row.product.coverImageUrl, price: toNum(row.product.price) },
        members: row.members,
      };
    },

    async incrementCount(roomId: string, count: number, completed: boolean): Promise<GroupRoomRow> {
      return mapRoom((await db['groupBuyingRoom'].update({
        where: { id: roomId },
        data: { currentMembersCount: count, status: completed ? 'COMPLETED' : 'WAITING_FOR_MEMBERS' },
      })) as Record<string, unknown>);
    },

    async expireDue(now: Date, limit: number): Promise<GroupRoomRow[]> {
      const rows = (await db['groupBuyingRoom'].findMany({
        where: { status: 'WAITING_FOR_MEMBERS', expiresAt: { lt: now } },
        orderBy: { expiresAt: 'asc' },
        take: limit,
      }).catch(() => [])) as Record<string, unknown>[];
      return rows.map(mapRoom);
    },

    async markExpired(roomId: string): Promise<void> {
      await db['groupBuyingRoom'].update({ where: { id: roomId }, data: { status: 'EXPIRED' } });
    },

    async markCancelled(roomId: string): Promise<void> {
      await db['groupBuyingRoom'].update({ where: { id: roomId }, data: { status: 'CANCELLED' } });
    },

    async userRooms(userId: string): Promise<GroupRoomRow[]> {
      const rows = (await db['groupBuyingRoom'].findMany({
        where: { members: { some: { userId } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }).catch(() => [])) as Record<string, unknown>[];
      return rows.map(mapRoom);
    },
  };
}

@Injectable()
export class PrismaGroupRepository implements GroupRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): GroupRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): GroupRepository {
    return toRepo(tx as Db);
  }

  findProduct(productId: string) { return this.root.findProduct(productId); }
  findConfig(productId: string) { return this.root.findConfig(productId); }
  createRoom(args: {
    productId: string; creatorId: string; groupType: string; requiredMembers: number;
    discountedPrice: number; roomCode: string; expiresAt: Date;
  }) { return this.root.createRoom(args); }
  addMember(args: { roomId: string; userId: string; orderId: string; isCreator: boolean }) { return this.root.addMember(args); }
  findById(roomId: string) { return this.root.findById(roomId); }
  incrementCount(roomId: string, count: number, completed: boolean) { return this.root.incrementCount(roomId, count, completed); }
  expireDue(now: Date, limit: number) { return this.root.expireDue(now, limit); }
  markExpired(roomId: string) { return this.root.markExpired(roomId); }
  markCancelled(roomId: string) { return this.root.markCancelled(roomId); }
  userRooms(userId: string) { return this.root.userRooms(userId); }
}
