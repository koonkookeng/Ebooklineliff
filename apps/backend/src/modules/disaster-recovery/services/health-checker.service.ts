// SSOT Phase 127 BDD-2 §8.2 — region health checker (3-missed-heartbeat trip)
// Canonical: apps/backend/src/modules/disaster-recovery/services/health-checker.service.ts
// (legacy src/backend/modules/disaster-recovery/services/health-checker.service.ts)
// - record() persists a SystemHealthMetric row + refreshes the Redis heartbeat
//   key; consecutiveMisses() reads the heartbeat age and counts missed 10s
//   beats; shouldFailover() trips at DR_HEARTBEAT_MISSES (3 ≈ 30s).
// - Pure heartbeat math exported for contract tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { DR_HEARTBEAT_INTERVAL_MS, DR_HEARTBEAT_MISSES } from '@repo/shared';

export interface HealthDbPort {
  systemHealthMetric: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface HealthEdgePort {
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

export const DR_HEARTBEAT_KEY = 'dr:primary:heartbeat';
export const DR_HEARTBEAT_TTL_SEC = 30;

export function missedBeats(lastBeatAtMs: number | null, nowMs: number): number {
  if (lastBeatAtMs === null) return DR_HEARTBEAT_MISSES;
  const age = nowMs - lastBeatAtMs;
  if (age < 0) return 0;
  return Math.floor(age / DR_HEARTBEAT_INTERVAL_MS);
}

export function shouldFailover(misses: number): boolean {
  return misses >= DR_HEARTBEAT_MISSES;
}

@Injectable()
export class HealthCheckerService {
  constructor(
    private readonly db: HealthDbPort,
    private readonly edge: HealthEdgePort,
  ) {}

  async record(input: {
    nodeName: string;
    cpuUsagePercent: number;
    memoryUsagePercent: number;
    dbConnectionPoolUsed: number;
    redisMemoryUsedMb: number;
    drState?: 'NORMAL' | 'FAILOVER_IN_PROGRESS' | 'FAILOVER_COMPLETED' | 'FAILBACK_IN_PROGRESS';
  }): Promise<void> {
    const now = new Date();
    try {
      await this.db.systemHealthMetric.create({ data: { ...input, recordedAt: now } });
    } catch {
      /* ledger write is best-effort under outage */
    }
    try {
      await this.edge.setex(DR_HEARTBEAT_KEY, DR_HEARTBEAT_TTL_SEC, String(now.getTime()));
    } catch {
      /* heartbeat loss surfaces as misses — never throws */
    }
  }

  async consecutiveMisses(nowMs = Date.now()): Promise<number> {
    try {
      const raw = await this.edge.get(DR_HEARTBEAT_KEY);
      return missedBeats(raw === null ? null : Number(raw), nowMs);
    } catch {
      return DR_HEARTBEAT_MISSES; // cache outage reads as down (fail-safe trip)
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const HealthCheckerServiceService = HealthCheckerService;
