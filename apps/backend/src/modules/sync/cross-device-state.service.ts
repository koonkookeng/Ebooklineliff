// SSOT Phase 070 Task 3 — CrossDeviceStateService (vector-clock SSOT)
// Canonical: apps/backend/src/modules/sync/cross-device-state.service.ts
// (legacy src/backend/modules/sync/cross-device-state.service.ts)
// - Complements Phase 057 (room transport + write-back worker): 070 owns
//   the authoritative edge row (Redis Hash sync:state:{userId}:{productId},
//   30d TTL) + Prisma CrossDeviceSyncState write-behind + room broadcast.
// - pushPosition: Zod gate → clock resolve (accept ties/newer, stale gets
//   server truth) → edge write (<5ms path) → broadcast → DB upsert.
// - tsx-safe structural ports. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  CrossDeviceSyncPayloadSchema,
  SYNC_STATE_TTL_SEC,
  DEVICE_SWITCH_STREAM,
  CROSS_DEVICE_EVENT,
  crossDeviceStateKey,
  crossDeviceChannel,
  resolveCrossDeviceConflict,
} from '@repo/shared';

export interface CrossDeviceStateRow {
  pageNumber?: string;
  watchedSec?: string;
  vectorClock?: string;
  sourceDevice?: string;
  contentType?: string;
  contentId?: string;
}

export interface CrossDeviceTables {
  crossDeviceSyncState: {
    findUnique(args: unknown): Promise<{ vectorClock: number; lastPage: number | null; lastWatchedSec: number | null; lastDevice: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface CrossDeviceCache {
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, fields: Record<string, string>): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
}

export interface CrossDeviceBus {
  publishRoom(channel: string, event: string, data: unknown): Promise<void>;
}

export interface CrossDeviceStream {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class CrossDeviceStateService {
  constructor(
    private readonly tables?: CrossDeviceTables,
    private readonly cache?: CrossDeviceCache,
    private readonly bus?: CrossDeviceBus,
    private readonly stream?: CrossDeviceStream,
  ) {}

  private async storedClock(userId: string, productId: string, contentType: string): Promise<number> {
    try {
      const edge = await this.cache?.hgetall(crossDeviceStateKey(userId, productId));
      const eClock = Number(edge?.['vectorClock'] ?? 0);
      if (Number.isInteger(eClock) && eClock > 0) return eClock;
    } catch {
      // edge fail-open → fall through to DB
    }
    const row = await this.tables?.crossDeviceSyncState
      .findUnique({ where: { userId_productId_contentType: { userId, productId, contentType } } })
      .catch(() => null);
    return row?.vectorClock ?? 0;
  }

  async pushPosition(
    userId: string,
    body: unknown,
  ): Promise<{ ok: boolean; resolvedPosition?: number; conflictResolved?: boolean; vectorClock?: number; error?: string }> {
    const parsed = CrossDeviceSyncPayloadSchema.safeParse(body);
    if (!parsed.success || parsed.data.userId !== userId) return { ok: false, error: 'INVALID_INPUT' };
    const p = parsed.data;
    const stored = await this.storedClock(userId, p.productId, p.contentType);
    const verdict = resolveCrossDeviceConflict(p.positionMarker.vectorClock, stored);
    const resolvedPosition = p.positionMarker.pageNumber ?? p.positionMarker.watchedSec ?? 0;
    if (!verdict.accept) {
      return { ok: true, resolvedPosition, conflictResolved: true, vectorClock: verdict.nextClock };
    }
    const key = crossDeviceStateKey(userId, p.productId);
    await this.cache
      ?.hset(key, {
        productId: p.productId,
        contentType: p.contentType,
        contentId: p.contentId,
        pageNumber: String(p.positionMarker.pageNumber ?? 0),
        watchedSec: String(p.positionMarker.watchedSec ?? 0),
        sourceDevice: p.sourceDevice,
        vectorClock: String(verdict.nextClock),
        updatedAt: new Date().toISOString(),
      })
      .catch(() => undefined);
    await this.cache?.expire(key, SYNC_STATE_TTL_SEC).catch(() => undefined);
    await this.bus
      ?.publishRoom(crossDeviceChannel(userId), CROSS_DEVICE_EVENT, { ...p, positionMarker: { ...p.positionMarker, vectorClock: verdict.nextClock } })
      .catch(() => undefined);
    await this.tables?.crossDeviceSyncState
      .upsert({
        where: { userId_productId_contentType: { userId, productId: p.productId, contentType: p.contentType } },
        update: {
          lastPage: p.positionMarker.pageNumber ?? undefined,
          lastWatchedSec: p.positionMarker.watchedSec ?? undefined,
          vectorClock: verdict.nextClock,
          lastDevice: p.sourceDevice,
        },
        create: {
          userId, productId: p.productId, contentType: p.contentType,
          lastPage: p.positionMarker.pageNumber ?? 1,
          lastWatchedSec: p.positionMarker.watchedSec ?? 0,
          vectorClock: verdict.nextClock,
          lastDevice: p.sourceDevice,
        },
      })
      .catch(() => undefined);
    await this.stream
      ?.xaddPipeline(DEVICE_SWITCH_STREAM, [{ userId, productId: p.productId, fromDevice: p.sourceDevice, clock: verdict.nextClock, at: Date.now() }])
      .catch(() => undefined);
    return { ok: true, resolvedPosition, conflictResolved: verdict.conflictResolved, vectorClock: verdict.nextClock };
  }

  async getLatest(userId: string, productId: string, contentType: string): Promise<Record<string, unknown> | null> {
    try {
      const edge = await this.cache?.hgetall(crossDeviceStateKey(userId, productId));
      if (edge && edge['vectorClock']) {
        return {
          productId, contentType, contentId: edge['contentId'] ?? productId,
          pageNumber: Number(edge['pageNumber'] ?? 0), watchedSec: Number(edge['watchedSec'] ?? 0),
          sourceDevice: edge['sourceDevice'] ?? 'UNKNOWN', vectorClock: Number(edge['vectorClock'] ?? 0),
        };
      }
    } catch {
      // edge fail-open
    }
    const row = await this.tables?.crossDeviceSyncState
      .findUnique({ where: { userId_productId_contentType: { userId, productId, contentType } } })
      .catch(() => null);
    if (!row) return null;
    return {
      productId, contentType, contentId: productId,
      pageNumber: row.lastPage ?? 0, watchedSec: row.lastWatchedSec ?? 0,
      sourceDevice: row.lastDevice, vectorClock: row.vectorClock,
    };
  }
}
