// SSOT Phase 123 Task 4/5 §5.2 — storage budget evaluation + Flex alert engine
// Canonical: apps/backend/src/modules/storage/services/storage-budget.service.ts
// (legacy src/backend/modules/storage/services/storage-budget.service.ts)
// - evaluateAll() is the 6h sweep lane (callers own the timer; no
//   @nestjs/schedule dep): latest metric per config → percent → severity →
//   LINE Flex dispatch + StorageCostAlertLog persistence. Alert rows persist
//   even when LINE delivery fails (status FAILED, Gate 7 atomicity per row).
// - Dedupes: skips tenants whose newest alert already covers the current
//   severity band (no Flex spam on every sweep).
// - Zero new deps (global fetch via the push port only).
import { Injectable, Logger } from '@nestjs/common';
import {
  STORAGE_FLEX_MAX_BYTES,
  budgetPercentUsed,
  budgetSeverityFor,
  type BudgetAlertThreshold,
} from '@repo/shared';

export interface BudgetConfigRow {
  tenantId: string;
  monthlyBudgetLimitTHB: number | string | { toString(): string };
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  notifyLineUserIds: string[];
  autoPurgeTempOnExceed: boolean;
}

export interface UsageMetricRow {
  tenantId: string;
  estimatedCostTHB: number | string | { toString(): string };
}

export interface AlertLogRow {
  tenantId: string;
  severity: string;
  percentUsed: number;
  triggeredAt: Date;
}

/** Minimal Prisma surface (structural; no hard import). */
export interface BudgetPrismaPort {
  storageBudgetAlertConfig: { findMany(): Promise<BudgetConfigRow[]> };
  storageUsageMetric: { findFirst(args: unknown): Promise<UsageMetricRow | null> };
  storageCostAlertLog: {
    findFirst(args: unknown): Promise<AlertLogRow | null>;
    create(args: unknown): Promise<unknown>;
  };
}

/** Minimal LINE push surface (structural; 122 client satisfies it). */
export interface BudgetLinePort {
  push(lineUserId: string, message: unknown): Promise<{ messageId: string } | { queued: boolean }>;
}

export interface BudgetEvaluation {
  tenantId: string;
  currentCostTHB: number;
  budgetLimitTHB: number;
  percentUsed: number;
  severity: BudgetAlertThreshold | 'OK';
  alerted: boolean;
}

const toNum = (v: number | string | { toString(): string }): number =>
  typeof v === 'number' ? v : Number(String(v));

/** Build the §5.2 budget Flex bubble (byte-guarded <10KB). */
export function buildStorageBudgetFlex(params: {
  severity: 'WARNING' | 'CRITICAL';
  currentCost: number;
  budgetLimit: number;
  percentUsed: number;
}): Record<string, unknown> {
  const bubble = {
    type: 'flex',
    altText: `Storage R2 budget alert (${params.percentUsed.toFixed(1)}%)`,
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: params.severity === 'CRITICAL' ? '#FF2D55' : '#FF9500' } },
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'STORAGE BUDGET ALERT', weight: 'bold', color: '#FFFFFF', size: 'xs' },
          { type: 'text', text: `Cloudflare R2 ${params.severity}`, weight: 'bold', color: '#FFFFFF', size: 'lg' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `Current cost: ${params.currentCost.toLocaleString()} THB`, size: 'sm', weight: 'bold' },
          { type: 'text', text: `Budget limit: ${params.budgetLimit.toLocaleString()} THB`, size: 'sm', color: '#8E8E93' },
          { type: 'text', text: `Used: ${params.percentUsed.toFixed(1)}%`, size: 'md', color: '#FF3B30', weight: 'bold' },
        ],
      },
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(bubble), 'utf8');
  if (bytes > STORAGE_FLEX_MAX_BYTES) throw new Error(`STORAGE_FLEX_OVERSIZE ${bytes}`);
  return bubble;
}

@Injectable()
export class StorageBudgetService {
  private readonly logger = new Logger(StorageBudgetService.name);

  constructor(
    private readonly prisma: BudgetPrismaPort,
    private readonly line: BudgetLinePort,
  ) {}

  /** Evaluate one tenant (pure math + latest metric read). */
  async evaluateTenant(config: BudgetConfigRow, metric: UsageMetricRow | null): Promise<BudgetEvaluation> {
    const currentCostTHB = metric ? toNum(metric.estimatedCostTHB) : 0;
    const budgetLimitTHB = toNum(config.monthlyBudgetLimitTHB);
    const percentUsed = budgetPercentUsed(currentCostTHB, budgetLimitTHB);
    const severity = budgetSeverityFor(percentUsed, config.warningThresholdPercent, config.criticalThresholdPercent);
    return { tenantId: config.tenantId, currentCostTHB, budgetLimitTHB, percentUsed, severity, alerted: false };
  }

  /**
   * 6h sweep lane: evaluate every config, Flex-alert on WARNING+, persist
   * the alert log (DELIVERED/FAILED), skip already-covered severity bands.
   */
  async evaluateAll(): Promise<BudgetEvaluation[]> {
    const configs = await this.prisma.storageBudgetAlertConfig.findMany();
    const out: BudgetEvaluation[] = [];
    for (const config of configs) {
      const metric = await this.prisma.storageUsageMetric.findFirst({
        where: { tenantId: config.tenantId },
        orderBy: { recordedAt: 'desc' },
      });
      const evaled = await this.evaluateTenant(config, metric);
      if (evaled.severity === 'OK') {
        out.push(evaled);
        continue;
      }
      const level: 'WARNING' | 'CRITICAL' =
        evaled.severity === 'CRITICAL_85_PERCENT' || evaled.severity === 'EXCEEDED_100_PERCENT' ? 'CRITICAL' : 'WARNING';
      const prior = await this.prisma.storageCostAlertLog.findFirst({
        where: { tenantId: config.tenantId, severity: level },
        orderBy: { triggeredAt: 'desc' },
      });
      if (prior && prior.percentUsed >= evaled.percentUsed) {
        out.push(evaled);
        continue;
      }
      const flex = buildStorageBudgetFlex({
        severity: level,
        currentCost: evaled.currentCostTHB,
        budgetLimit: evaled.budgetLimitTHB,
        percentUsed: evaled.percentUsed,
      });
      let delivered = true;
      let lineLogResponse: unknown = null;
      for (const lineUserId of config.notifyLineUserIds) {
        try {
          lineLogResponse = await this.line.push(lineUserId, flex);
        } catch (err) {
          delivered = false;
          lineLogResponse = { error: (err as Error).message };
        }
      }
      try {
        await this.prisma.storageCostAlertLog.create({
          data: {
            tenantId: config.tenantId,
            severity: level,
            alertMessage: `Storage cost reached ${evaled.percentUsed.toFixed(1)}% of total budget limit.`,
            currentCostTHB: evaled.currentCostTHB,
            budgetLimitTHB: evaled.budgetLimitTHB,
            percentUsed: evaled.percentUsed,
            deliveryStatus: delivered ? 'DELIVERED' : 'FAILED',
            lineLogResponse: lineLogResponse as Record<string, unknown>,
          },
        });
      } catch (err) {
        this.logger.warn(`Alert-log persistence fail-open for ${config.tenantId}: ${(err as Error).message}`);
      }
      out.push({ ...evaled, alerted: true });
      this.logger.log(`Storage budget ${level} for ${config.tenantId} at ${evaled.percentUsed.toFixed(1)}%`);
    }
    return out;
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { StorageBudgetService as StorageBudgetServiceService };
