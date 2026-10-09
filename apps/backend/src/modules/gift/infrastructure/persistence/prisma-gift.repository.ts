// SSOT Phase 089 §5.1 — Prisma gift repository (structural adapter)
// Canonical: apps/backend/src/modules/gift/infrastructure/persistence/prisma-gift.repository.ts
// - Claim/expiry mutations run inside caller-owned $transactions (Gate 7);
//   this adapter only shapes rows. Entitlement writes ride the same txn via
//   the injected 012 grant service (no duplicate grant code).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import type { GiftProductRow, GiftRepository, GiftRow } from '../../domain/repository/gift.repository.interface';

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function mapGift(r: Record<string, unknown>): GiftRow {
  return {
    id: String(r['id']),
    orderId: (r['orderId'] as string | null) ?? null,
    senderUserId: String(r['senderUserId']),
    recipientUserId: (r['recipientUserId'] as string | null) ?? null,
    productId: String(r['productId']),
    claimCode: String(r['claimCode']),
    status: String(r['status']),
    greetingTheme: String(r['greetingTheme']),
    greetingMessage: String(r['greetingMessage']),
    senderDisplayName: String(r['senderDisplayName']),
    isAnonymous: Boolean(r['isAnonymous']),
    expiresAt: r['expiresAt'] as Date,
    claimedAt: (r['claimedAt'] as Date | null) ?? null,
  };
}

function toRepo(db: Db): GiftRepository {
  return {
    async findProduct(productId: string): Promise<GiftProductRow | null> {
      const p = (await db['product'].findUnique({ where: { id: productId } }).catch(() => null)) as {
        id: string; title: string; coverImageUrl: string; productType: string;
      } | null;
      return p ?? null;
    },

    async createGift(args: {
      senderUserId: string; productId: string; claimCode: string;
      greetingTheme: string; greetingMessage: string; senderDisplayName: string;
      isAnonymous: boolean; expiresAt: Date;
    }): Promise<GiftRow> {
      return mapGift((await db['giftOrder'].create({ data: { ...args } })) as Record<string, unknown>);
    },

    async findByClaimCode(claimCode: string) {
      const row = (await db['giftOrder'].findUnique({
        where: { claimCode },
        include: { product: true },
      }).catch(() => null)) as (Record<string, unknown> & { product: GiftProductRow }) | null;
      if (!row) return null;
      return { ...mapGift(row), product: row.product };
    },

    async findById(id: string): Promise<GiftRow | null> {
      const row = (await db['giftOrder'].findUnique({ where: { id } }).catch(() => null)) as Record<string, unknown> | null;
      return row ? mapGift(row) : null;
    },

    async bindOrder(giftId: string, orderId: string): Promise<void> {
      await db['giftOrder'].update({
        where: { id: giftId },
        data: { orderId, status: 'READY_TO_CLAIM' },
      });
    },

    async claimAtomic(args: { giftId: string; recipientUserId: string }): Promise<GiftRow> {
      return mapGift((await db['giftOrder'].update({
        where: { id: args.giftId },
        data: { status: 'CLAIMED', recipientUserId: args.recipientUserId, claimedAt: new Date() },
      })) as Record<string, unknown>);
    },

    async senderGifts(senderUserId: string): Promise<GiftRow[]> {
      const rows = (await db['giftOrder'].findMany({
        where: { senderUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }).catch(() => [])) as Record<string, unknown>[];
      return rows.map(mapGift);
    },

    async expireDue(now: Date, limit: number): Promise<GiftRow[]> {
      const rows = (await db['giftOrder'].findMany({
        where: { status: 'READY_TO_CLAIM', expiresAt: { lt: now } },
        orderBy: { expiresAt: 'asc' },
        take: limit,
      }).catch(() => [])) as Record<string, unknown>[];
      return rows.map(mapGift);
    },

    async revertToSender(giftId: string): Promise<void> {
      await db['giftOrder'].update({
        where: { id: giftId },
        data: { status: 'EXPIRED_REVERTED', revertedAt: new Date() },
      });
    },
  };
}

@Injectable()
export class PrismaGiftRepository implements GiftRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): GiftRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): GiftRepository {
    return toRepo(tx as Db);
  }

  findProduct(productId: string) { return this.root.findProduct(productId); }
  createGift(args: {
    senderUserId: string; productId: string; claimCode: string;
    greetingTheme: string; greetingMessage: string; senderDisplayName: string;
    isAnonymous: boolean; expiresAt: Date;
  }) { return this.root.createGift(args); }
  findByClaimCode(claimCode: string) { return this.root.findByClaimCode(claimCode); }
  findById(id: string) { return this.root.findById(id); }
  bindOrder(giftId: string, orderId: string) { return this.root.bindOrder(giftId, orderId); }
  claimAtomic(args: { giftId: string; recipientUserId: string }) { return this.root.claimAtomic(args); }
  senderGifts(senderUserId: string) { return this.root.senderGifts(senderUserId); }
  expireDue(now: Date, limit: number) { return this.root.expireDue(now, limit); }
  revertToSender(giftId: string) { return this.root.revertToSender(giftId); }
}
