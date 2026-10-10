// SSOT Phase 118 Task 5 §4.1/BDD-2 — daily integrity checker cron
// Canonical: apps/backend/src/modules/audit-log/application/integrity-checker.cron.ts
// (legacy src/backend/modules/audit-log/application/integrity-checker.cron.ts)
// - runOnce(): bounded oldest-first replay (default 5000) -> on break:
//   Flex TAMPER alert to configured super-admin lines + `audit.tamper`
//   stream + `admin.lock.requested` per affected actor (109 owns the freeze;
//   Zero Redundant). NEVER updates AuditLog rows (append-only holds even
//   for incident state — Gate 4).
// - start() wires the 24h cadence in prod; the module does NOT auto-start
//   (tests stay deterministic; bootstrap calls start()).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { AUDIT_CRON_INTERVAL_MS, AUDIT_EVENT_STREAM } from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { AuditLogService } from './audit-log.service';
import { AuditNotificationService } from './audit-notify.service';
import { buildAuditFlex, auditFlexByteSize, AUDIT_FLEX_BUDGET_BYTES } from './audit-flex.builder';

export interface IntegrityReport {
  valid: boolean;
  checked: number;
  brokenAt?: number | bigint;
  tamperedBlockSequences: number[];
  alerted: boolean;
}

function alertLineIds(): string[] {
  return (process.env['AUDIT_ALERT_LINE_USER_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class IntegrityCheckerCron {
  private readonly logger = new Logger(IntegrityCheckerCron.name);

  constructor(
    private readonly audit: AuditLogService,
    private readonly redis: RedisClusterService,
    private readonly notify: AuditNotificationService,
  ) {}

  async runOnce(window = 5000, tenantName = 'default'): Promise<IntegrityReport> {
    const verdict = await this.audit.verifyChain(0, window);
    if (verdict.valid) {
      try {
        await this.redis.xaddPipeline(AUDIT_EVENT_STREAM, [{
          event: 'audit.integrity.verified', checked: verdict.checked, at: Date.now(),
        }]);
      } catch {
        // Telemetry never breaks the checker.
      }
      return { ...verdict, alerted: false };
    }
    const bubble = buildAuditFlex({
      outcome: 'TAMPER_DETECTED',
      tenantName,
      ...(verdict.brokenAt !== undefined ? { brokenAt: verdict.brokenAt } : {}),
      checked: verdict.checked,
    });
    const detail = auditFlexByteSize(bubble) <= AUDIT_FLEX_BUDGET_BYTES ? JSON.stringify(bubble) : `TAMPER at ${String(verdict.brokenAt)}`;
    for (const lineId of alertLineIds()) {
      try {
        await this.notify.notify(lineId, 'TAMPER_DETECTED', detail);
      } catch {
        // Notify is fail-open — the incident stream below is canonical.
      }
    }
    try {
      await this.redis.xaddPipeline(AUDIT_EVENT_STREAM, [{
        event: 'audit.tamper.detected',
        brokenAt: String(verdict.brokenAt ?? ''),
        sequences: verdict.tamperedBlockSequences.join(','),
        at: Date.now(),
      }]);
      await this.redis.xaddPipeline('stream:admin:lock', [{
        event: 'admin.lock.requested',
        reason: 'audit-tamper',
        at: Date.now(),
      }]);
    } catch {
      // Telemetry never breaks the checker.
    }
    this.logger.error(`Audit TAMPER detected at block ${String(verdict.brokenAt)} (${verdict.checked} checked)`);
    return { ...verdict, alerted: true };
  }

  start(intervalMs = AUDIT_CRON_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      void this.runOnce().catch((err: Error) => this.logger.warn(`Integrity sweep failed: ${err.message}`));
    }, intervalMs);
  }
}
