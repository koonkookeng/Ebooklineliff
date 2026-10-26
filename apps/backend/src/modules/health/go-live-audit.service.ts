// SSOT Phase 130 §5.2/§11 — go-live audit service (9-gate final clearance)
// Canonical: apps/backend/src/modules/health/go-live-audit.service.ts
// (legacy src/backend/modules/health/*)
// - RISK_CALL: no @nestjs/terminus (not installed) — readiness is two
//   timed port pings (Prisma $queryRaw SELECT 1 + Redis GET) with a
//   redacted envelope (no hosts, DSNs, or secrets — Gate 4). The 001
//   liveness lane stays untouched; this file owns readiness + audit.
// - buildGoLiveReport() is fail-closed: Zod rejects anything but a
//   100-or-nothing pass. Ports-based (tsx-importable). Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  GoLiveAuditReportSchema,
  gatekeepersPass,
  overallScoreFor,
  type GoLiveAuditReport,
  type ProductionHealthStatus,
} from '@repo/shared';

export interface ReadinessDbPort {
  queryRaw(args: unknown): Promise<unknown>;
}

export interface ReadinessEdgePort {
  get(key: string): Promise<string | null>;
}

export interface ReadinessCheck {
  status: ProductionHealthStatus;
  database: { up: boolean; elapsedMs: number };
  redis: { up: boolean; elapsedMs: number };
  elapsedMs: number;
  checkedAt: string;
}

export interface GateEvidence {
  schemaSync: boolean;
  typeSafety: boolean;
  liffRamCheck: boolean;
  zeroEgressCheck: boolean;
  slipVerifyLatencyMs: number;
  securityPenTestPassed: boolean;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ up: boolean; elapsedMs: number }> {
  const started = Date.now();
  try {
    await fn();
    return { up: true, elapsedMs: Date.now() - started };
  } catch {
    return { up: false, elapsedMs: Date.now() - started };
  }
}

@Injectable()
export class GoLiveAuditService {
  constructor(
    private readonly db: ReadinessDbPort,
    private readonly edge: ReadinessEdgePort,
  ) {}

  /** Kubernetes readiness probe shape (redacted, fast). */
  async readiness(): Promise<ReadinessCheck> {
    const started = Date.now();
    const [database, redis] = await Promise.all([
      timed(() => this.db.queryRaw('SELECT 1')),
      timed(() => this.edge.get('golive:readiness:probe')),
    ]);
    // A DB outage is unrecoverable (CRITICAL_FAILURE); a Redis outage still
    // serves cached reads (DEGRADED). Never report HEALTHY on a failed ping.
    const status: ProductionHealthStatus = !database.up
      ? 'CRITICAL_FAILURE'
      : redis.up
        ? 'HEALTHY'
        : 'DEGRADED';
    return {
      status,
      database,
      redis,
      elapsedMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Fail-closed 9-gate report (§11 — 100-or-nothing). */
  buildGoLiveReport(deploymentId: string, gates: GateEvidence): GoLiveAuditReport {
    const pass = gatekeepersPass(gates);
    const parsed = GoLiveAuditReportSchema.safeParse({
      deploymentId,
      timestamp: new Date().toISOString(),
      environment: 'production',
      gatekeeperStatus: gates,
      overallScore: overallScoreFor(pass),
    });
    if (!parsed.success) {
      throw new Error(`Go-live audit REJECTED: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    return parsed.data;
  }
}
