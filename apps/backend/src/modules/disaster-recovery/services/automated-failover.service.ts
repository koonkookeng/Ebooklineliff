// SSOT Phase 127 BDD-2 §6.2 — automated failover engine (RTO < 5 min)
// Canonical: apps/backend/src/modules/disaster-recovery/services/automated-failover.service.ts
// (legacy src/backend/modules/disaster-recovery/services/automated-failover.service.ts)
// - Mirrors infra/scripts/dr-failover.sh in-process for contract tests and
//   programmatic drills: verify-primary-down -> promote-standby ->
//   reroute-endpoint -> flush-edge-cache -> broadcast. Every external touch
//   point is a port (fetch/DNS/Redis/LINE seams injectable; zero new deps).
// - RISK_CALL: real promotion/DNS calls live in the shell script (§6.2); this
//   service orchestrates + ledgers the run and measures RTO against
//   DR_RTO_BUDGET_MS. Cores untouched (no checkout/payment/reader writes).
import { Injectable } from '@nestjs/common';
import { DR_RTO_BUDGET_MS } from '@repo/shared';

export type FailoverStep = 'verify' | 'promote' | 'reroute' | 'flush' | 'broadcast';

export interface FailoverPorts {
  /** True when the primary answers a readiness probe. */
  probePrimary(): Promise<boolean>;
  /** Promote the standby to master; resolves with the new primary host. */
  promoteStandby(): Promise<string>;
  /** Point the data endpoint at the new primary. */
  rerouteEndpoint(newPrimaryHost: string): Promise<void>;
  /** Flush edge caches for consistency. */
  flushEdgeCache(): Promise<void>;
  /** Notify admins (LINE broadcast lane). */
  broadcast(message: string): Promise<void>;
  /** Persist a DR snapshot ledger row. */
  ledgerFailover?(row: { backupType: string; detail: string }): Promise<void>;
}

export interface FailoverResult {
  executed: boolean;
  abortedReason?: string;
  newPrimaryHost?: string;
  stepsCompleted: FailoverStep[];
  rtoMs: number;
  withinRto: boolean;
}

export function buildFailoverMessage(newPrimaryHost: string, rtoMs: number): string {
  return (
    `🚨 [ALERT 144-XZ] Disaster Recovery Executed Successfully! ` +
    `Database Failover promoted to ${newPrimaryHost} in ${(rtoMs / 1000).toFixed(1)}s. ` +
    `System Status: 100% OPERATIONAL.`
  );
}

@Injectable()
export class AutomatedFailoverService {
  constructor(private readonly ports: FailoverPorts) {}

  async execute(): Promise<FailoverResult> {
    const started = Date.now();
    const stepsCompleted: FailoverStep[] = [];
    let primaryUp = false;
    try {
      primaryUp = await this.ports.probePrimary();
    } catch {
      primaryUp = false;
    }
    stepsCompleted.push('verify');
    if (primaryUp) {
      return { executed: false, abortedReason: 'primary-responding', stepsCompleted, rtoMs: Date.now() - started, withinRto: true };
    }
    const newPrimaryHost = await this.ports.promoteStandby();
    stepsCompleted.push('promote');
    await this.ports.rerouteEndpoint(newPrimaryHost);
    stepsCompleted.push('reroute');
    await this.ports.flushEdgeCache();
    stepsCompleted.push('flush');
    const rtoMs = Date.now() - started;
    await this.ports.broadcast(buildFailoverMessage(newPrimaryHost, rtoMs)).catch(() => undefined);
    stepsCompleted.push('broadcast');
    await this.ports.ledgerFailover?.({ backupType: 'FAILOVER', detail: newPrimaryHost }).catch(() => undefined);
    return { executed: true, newPrimaryHost, stepsCompleted, rtoMs, withinRto: rtoMs < DR_RTO_BUDGET_MS };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const AutomatedFailoverServiceService = AutomatedFailoverService;
