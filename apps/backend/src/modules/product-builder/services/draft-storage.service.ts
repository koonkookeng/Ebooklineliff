// SSOT Phase 074 §5.2 — Draft storage (Redis hot + PG persist)
// Canonical: apps/backend/src/modules/product-builder/services/draft-storage.service.ts
// - save: Redis setex 24h (sub-ms autosave, BDD-1) then PG upsert by draftId
//   (create when absent — no nil-uuid upsert hack; seller-owned rows only).
// - load: Redis-first, PG fallback with refill (100ms hydration, §10).
// - Port-based ctor (DB-free contract tests). Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { BUILDER_DRAFT_TTL_SEC, builderDraftKey } from '@repo/shared';

export interface DraftRow {
  id: string;
  sellerId: string;
  productType: string;
  stepIndex: number;
  payloadJson: unknown;
  updatedAt: Date;
}

export interface DraftTables {
  productDraft: {
    findOwned(id: string, sellerId: string): Promise<DraftRow | null>;
    create(args: { sellerId: string; productType: string; draftName: string; stepIndex: number; payloadJson: unknown }): Promise<DraftRow>;
    updateOwned(id: string, sellerId: string, args: { stepIndex: number; payloadJson: unknown }): Promise<void>;
    deleteOwned(id: string, sellerId: string): Promise<void>;
  };
}

export interface DraftCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

@Injectable()
export class DraftStorageService {
  private readonly logger = new Logger(DraftStorageService.name);

  constructor(
    private readonly tables: DraftTables,
    private readonly cache: DraftCache,
  ) {}

  static withInfra(prisma: PrismaService, redis: RedisClusterService): DraftStorageService {
    const tables: DraftTables = {
      productDraft: {
        findOwned: (id, sellerId) =>
          (prisma as unknown as {
            productDraft: { findFirst(a: unknown): Promise<DraftRow | null> };
          }).productDraft.findFirst({ where: { id, sellerId } }).catch(() => null),
        create: (args) =>
          (prisma as unknown as { productDraft: { create(a: unknown): Promise<DraftRow> } }).productDraft.create({
            data: { ...args, payloadJson: args.payloadJson as object },
          }),
        updateOwned: (id, sellerId, args) =>
          (prisma as unknown as { productDraft: { updateMany(a: unknown): Promise<unknown> } }).productDraft
            .updateMany({ where: { id, sellerId }, data: { ...args, payloadJson: args.payloadJson as object } })
            .then(() => undefined),
        deleteOwned: (id, sellerId) =>
          (prisma as unknown as { productDraft: { deleteMany(a: unknown): Promise<unknown> } }).productDraft
            .deleteMany({ where: { id, sellerId } })
            .then(() => undefined),
      },
    };
    return new DraftStorageService(tables, redis);
  }

  key(sellerId: string, draftId: string): string {
    return builderDraftKey(sellerId, draftId);
  }

  async save(sellerId: string, draftId: string | undefined, stepIndex: number, productType: string, draftName: string, payload: unknown): Promise<DraftRow> {
    let row: DraftRow | null = null;
    if (draftId) row = await this.tables.productDraft.findOwned(draftId, sellerId).catch(() => null);
    if (row) {
      await this.tables.productDraft.updateOwned(row.id, sellerId, { stepIndex, payloadJson: payload });
      row = { ...row, stepIndex, payloadJson: payload, updatedAt: new Date() };
    } else {
      row = await this.tables.productDraft.create({ sellerId, productType, draftName, stepIndex, payloadJson: payload });
    }
    const snapshot = JSON.stringify({ stepIndex, payload, updatedAt: new Date().toISOString() });
    try {
      await this.cache.setex(this.key(sellerId, row.id), BUILDER_DRAFT_TTL_SEC, snapshot);
    } catch (e) {
      this.logger.warn(`draft cache refill skipped: ${(e as Error).message}`);
    }
    return row;
  }

  async load(sellerId: string, draftId: string): Promise<{ stepIndex: number; payload: unknown } | null> {
    try {
      const cached = await this.cache.get(this.key(sellerId, draftId));
      if (cached) {
        const hit = JSON.parse(cached) as { stepIndex: number; payload: unknown };
        if (typeof hit.stepIndex === 'number') return hit;
      }
    } catch {
      // Corrupt entry: fall through to PG refill.
    }
    const row = await this.tables.productDraft.findOwned(draftId, sellerId).catch(() => null);
    if (!row) return null;
    const snapshot = { stepIndex: row.stepIndex, payload: row.payloadJson };
    try {
      await this.cache.setex(this.key(sellerId, draftId), BUILDER_DRAFT_TTL_SEC, JSON.stringify(snapshot));
    } catch {
      // Best-effort refill.
    }
    return snapshot;
  }

  async discard(sellerId: string, draftId: string): Promise<void> {
    await this.tables.productDraft.deleteOwned(draftId, sellerId).catch(() => undefined);
    try {
      await this.cache.del(this.key(sellerId, draftId));
    } catch {
      // Best-effort.
    }
  }
}
