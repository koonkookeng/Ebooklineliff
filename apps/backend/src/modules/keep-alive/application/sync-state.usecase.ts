// SSOT Phase 031 §5.1 — Sync-state use-case (framework-free, unit-testable core)
// Canonical: apps/backend/src/modules/keep-alive/application/sync-state.usecase.ts
// (legacy src/backend/modules/keep-alive/application/sync-state.usecase.ts)
// - Thin-nest pattern (Phase 028 precedent): validate (Zod) → entity guard →
//   atomic upsert (@@unique user/tenant/viewport, Gate 7) → edge cache →
//   app-switch event (Gate 8, best-effort). Sinks never throw the sync path.
// - Zero new deps.
import {
  KEEPALIVE_CHANNEL,
  KeepAliveSyncPayloadSchema,
  pickViewportState,
  type KeepAliveSyncPayload,
} from '@repo/shared';
import { KeepAliveState } from '../domain/keep-alive.entity';

export interface SyncStatePorts {
  upsert: (args: { whereUser: string; tenantId: string; viewportType: string; stateJson: unknown }) => Promise<{ lastActiveAt: Date }>;
  findLatest: (args: { userId: string; tenantId: string; viewportType: string }) => Promise<{ stateJson: unknown; lastActiveAt: Date } | null>;
  cacheSet: (userId: string, tenantId: string, viewportType: string, stateJson: string) => Promise<void>;
  cacheGet: (userId: string, tenantId: string, viewportType: string) => Promise<string | null>;
  publish: (channel: string, message: string) => Promise<void>;
  warn?: (message: string) => void;
}

export interface SyncStateResult {
  success: boolean;
  restoredTimestamp: string;
}

export async function syncViewportState(
  ports: SyncStatePorts,
  body: unknown,
): Promise<SyncStateResult> {
  const parsed = KeepAliveSyncPayloadSchema.safeParse(body);
  if (!parsed.success) throw new Error('Invalid keep-alive sync payload');
  const input: KeepAliveSyncPayload = parsed.data;
  const branch = pickViewportState(input);
  if (!branch) throw new Error('Viewport state branch missing');
  const entity = KeepAliveState.create({
    userId: input.userId,
    tenantId: input.tenantId,
    viewportType: input.viewportType,
    stateJson: branch,
    timestamp: input.timestamp,
  });

  const saved = await ports.upsert({
    whereUser: entity.props.userId,
    tenantId: entity.props.tenantId,
    viewportType: entity.props.viewportType,
    stateJson: entity.props.stateJson,
  });

  const snapshot = JSON.stringify(entity.props.stateJson);
  await ports.cacheSet(input.userId, input.tenantId, input.viewportType, snapshot).catch(() => undefined);
  await ports
    .publish(
      KEEPALIVE_CHANNEL,
      JSON.stringify({ event: 'liff.app_switch_out', userId: input.userId, tenantId: input.tenantId, viewportType: input.viewportType }),
    )
    .catch((err: unknown) => {
      ports.warn?.(`Keep-alive event failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });

  return { success: true, restoredTimestamp: saved.lastActiveAt.toISOString() };
}

export async function latestViewportState(
  ports: Pick<SyncStatePorts, 'findLatest' | 'cacheGet'>,
  userId: string,
  tenantId: string,
  viewportType: string,
): Promise<SyncStateResult & { stateJson: unknown | null }> {
  if (!userId || !tenantId || !viewportType) throw new Error('Missing keep-alive identity');
  const cached = await ports.cacheGet(userId, tenantId, viewportType).catch(() => null);
  if (cached) {
    try {
      return { success: true, restoredTimestamp: new Date().toISOString(), stateJson: JSON.parse(cached) as unknown };
    } catch {
      // Corrupt edge entry: fall through to PG.
    }
  }
  const row = await ports.findLatest({ userId, tenantId, viewportType });
  if (!row) return { success: false, restoredTimestamp: new Date(0).toISOString(), stateJson: null };
  return { success: true, restoredTimestamp: row.lastActiveAt.toISOString(), stateJson: row.stateJson };
}
