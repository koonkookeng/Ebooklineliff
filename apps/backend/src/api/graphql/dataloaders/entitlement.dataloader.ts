// SSOT Phase 128 §5.1/BDD-2 — zero-dep DataLoader batching (N+1 elimination)
// Canonical: apps/backend/src/api/graphql/dataloaders/entitlement.dataloader.ts
// (legacy src/backend/api/graphql/dataloaders/entitlement.dataloader.ts)
// - RISK_CALL: no `dataloader` package (zero-new-dep lane, 062 precedent).
//   This file is the single batching engine: microtask-coalesced queues,
//   per-request instances (one loader per GraphQL request => request cache),
//   input-order-preserving maps. Entitlement batch = 1 SQL; order batch =
//   exactly 3 SQL (orders, items, products) for any N (BDD-2 contract).
// - Ports-based (tsx-importable); Nest scope comes from per-request factory
//   use in resolvers via EntitlementModule. Zero new deps.
import { ORDER_BATCH_QUERY_COUNT } from '@repo/shared';

export interface EntitlementRow {
  id: string;
  userId: string;
  productId: string;
  accessType: string;
  expiresAt: Date | string | null;
}

export interface EntitlementDbPort {
  entitlement: {
    findMany(args: {
      where: { userId: { in: string[] } };
      select?: Record<string, boolean>;
    }): Promise<EntitlementRow[]>;
  };
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  userId: string;
  netAmount: unknown;
}

export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string;
  price: unknown;
  quantity: number;
}

export interface ProductRow {
  id: string;
  title: string;
  productType: string;
}

export interface OrderDbPort {
  order: { findMany(args: { where: { id: { in: string[] } } }): Promise<OrderRow[]> };
  orderItem: { findMany(args: { where: { orderId: { in: string[] } } }): Promise<OrderItemRow[]> };
  product: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: boolean; title: boolean; productType: boolean };
    }): Promise<ProductRow[]>;
  };
}

export interface OrderWithItems extends OrderRow {
  items: Array<OrderItemRow & { product: ProductRow | null }>;
}

/**
 * Request-scoped entitlement loader (spec §5.1 behavior, zero-dep).
 * One tick of N loads => exactly 1 findMany; results map per userId.
 */
export function createEntitlementLoader(db: EntitlementDbPort): {
  load: (userId: string) => Promise<EntitlementRow[]>;
  loadMany: (userIds: string[]) => Promise<EntitlementRow[][]>;
  prime: (userId: string, rows: EntitlementRow[]) => void;
  clear: (userId?: string) => void;
} {
  const cache = new Map<string, EntitlementRow[]>();
  let pending: string[] | null = null;
  let waiters: Array<{
    keys: string[];
    resolve: (v: EntitlementRow[][]) => void;
    reject: (e: unknown) => void;
  }> = [];

  async function flush(): Promise<void> {
    const keys = pending ?? [];
    pending = null;
    const current = waiters;
    waiters = [];
    const unique = [...new Set(keys)].filter((k) => !cache.has(k));
    try {
      const rows = unique.length > 0
        ? await db.entitlement.findMany({
            where: { userId: { in: unique } },
            select: { id: true, userId: true, productId: true, accessType: true, expiresAt: true },
          })
        : [];
      const byUser = new Map<string, EntitlementRow[]>();
      for (const id of unique) byUser.set(id, []);
      for (const row of rows) byUser.get(row.userId)?.push(row);
      for (const [id, list] of byUser) cache.set(id, list);
    } catch (err) {
      for (const w of current) w.reject(err);
      return;
    }
    for (const w of current) w.resolve(w.keys.map((k) => cache.get(k) ?? []));
  }

  function enqueue(keys: string[]): Promise<EntitlementRow[][]> {
    const uncached = keys.filter((k) => !cache.has(k));
    if (uncached.length === 0) return Promise.resolve(keys.map((k) => cache.get(k) ?? []));
    return new Promise<EntitlementRow[][]>((resolve, reject) => {
      if (pending === null) {
        pending = [];
        queueMicrotask(() => void flush());
      }
      pending.push(...uncached);
      waiters.push({ keys, resolve, reject });
    });
  }

  return {
    load: (userId) => enqueue([userId]).then((r) => r[0]),
    loadMany: (userIds) => enqueue(userIds),
    prime: (userId, rows) => {
      cache.set(userId, rows);
    },
    clear: (userId) => {
      if (userId) cache.delete(userId);
      else cache.clear();
    },
  };
}

/**
 * Request-scoped order loader (BDD-2: any N orders => exactly 3 SQL).
 * q1 orders -> q2 items -> q3 products; products joined in memory.
 */
export function createOrderLoader(db: OrderDbPort): {
  load: (orderId: string) => Promise<OrderWithItems | null>;
  loadMany: (orderIds: string[]) => Promise<Array<OrderWithItems | null>>;
  clear: () => void;
} {
  const cache = new Map<string, OrderWithItems | null>();
  let pending: string[] | null = null;
  let waiters: Array<{
    keys: string[];
    resolve: (v: Array<OrderWithItems | null>) => void;
    reject: (e: unknown) => void;
  }> = [];

  async function flush(): Promise<void> {
    const keys = pending ?? [];
    pending = null;
    const current = waiters;
    waiters = [];
    const unique = [...new Set(keys)].filter((k) => !cache.has(k));
    try {
      if (unique.length > 0) {
        // Exactly ORDER_BATCH_QUERY_COUNT SQL round-trips (BDD-2).
        const orders = await db.order.findMany({ where: { id: { in: unique } } });
        const items = await db.orderItem.findMany({ where: { orderId: { in: unique } } });
        const products = await db.product.findMany({
          where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
          select: { id: true, title: true, productType: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        const itemsByOrder = new Map<string, OrderWithItems['items']>();
        for (const id of unique) itemsByOrder.set(id, []);
        for (const item of items) {
          itemsByOrder.get(item.orderId)?.push({ ...item, product: productById.get(item.productId) ?? null });
        }
        const orderById = new Map(orders.map((o) => [o.id, o]));
        for (const id of unique) {
          const order = orderById.get(id);
          cache.set(id, order ? { ...order, items: itemsByOrder.get(id) ?? [] } : null);
        }
      }
    } catch (err) {
      for (const w of current) w.reject(err);
      return;
    }
    for (const w of current) w.resolve(w.keys.map((k) => cache.get(k) ?? null));
  }

  function enqueue(keys: string[]): Promise<Array<OrderWithItems | null>> {
    const uncached = keys.filter((k) => !cache.has(k));
    if (uncached.length === 0) return Promise.resolve(keys.map((k) => cache.get(k) ?? null));
    return new Promise<Array<OrderWithItems | null>>((resolve, reject) => {
      if (pending === null) {
        pending = [];
        queueMicrotask(() => void flush());
      }
      pending.push(...uncached);
      waiters.push({ keys, resolve, reject });
    });
  }

  return {
    load: (orderId) => enqueue([orderId]).then((r) => r[0]),
    loadMany: (orderIds) => enqueue(orderIds),
    clear: () => cache.clear(),
  };
}

export { ORDER_BATCH_QUERY_COUNT };
