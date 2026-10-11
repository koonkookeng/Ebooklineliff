// SSOT Phase 123 Task 6 §3.2 — storage intent handler (decorator-free core)
// Canonical: apps/backend/src/modules/storage/services/storage-handler.service.ts
// - All six §3.2 intents as plain methods (auth via explicit user param):
//   the code-first resolver and the REST controller are thin shells over
//   this class (decorator shells stay unimportable under plain tsx, 115
//   precedent — behavior is fully covered here).
// - Reads are Prisma-structural (fakes in tests); writes delegate to the
//   lifecycle/budget services. Mutations require admin roles.
// - Zero new deps.
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  R2LifecycleRuleSchema,
  StorageCostBudgetConfigSchema,
  type R2LifecycleRule,
} from '@repo/shared';
import { R2LifecycleService } from './r2-lifecycle.service';
import { StorageBudgetService } from './storage-budget.service';

export interface StorageUser {
  id: string;
  role?: string;
}

export interface LifecycleRuleInput {
  ruleId: string;
  prefix: string;
  enabled: boolean;
  expireDays?: number | null;
  abortIncompleteMultipartDays?: number | null;
  description?: string | null;
}

export interface BudgetConfigInput {
  tenantId: string;
  monthlyBudgetLimitTHB: number;
  warningThresholdPercent?: number | null;
  criticalThresholdPercent?: number | null;
  notifyLineUserIds: string[];
  autoPurgeTempOnExceed?: boolean | null;
}

export interface StorageReadPort {
  storageUsageMetric: { findFirst(args: unknown): Promise<Record<string, unknown> | null> };
  storageBudgetAlertConfig: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    upsert(args: unknown): Promise<Record<string, unknown>>;
  };
  storageBucketPolicy: {
    findMany(args: unknown): Promise<Record<string, unknown>[]>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface StorageMetricView {
  totalSizeBytes: number;
  totalObjectsCount: number;
  classAOperationsCount: number;
  classBOperationsCount: number;
  estimatedMonthlyCostTHB: number;
  recordedAt: string;
}

export interface LifecycleRuleView {
  ruleId: string;
  prefix: string;
  enabled: boolean;
  expireDays: number | null;
  abortIncompleteMultipartDays: number;
  description: string | null;
}

export interface StorageBudgetView {
  tenantId: string;
  monthlyBudgetLimitTHB: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  notifyLineUserIds: string[];
  autoPurgeTempOnExceed: boolean;
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

export function requireStorageUser(user: StorageUser | undefined): StorageUser {
  if (!user?.id) throw new BadRequestException('Missing authentication');
  return user;
}

export function requireStorageAdmin(user: StorageUser | undefined): StorageUser {
  const u = requireStorageUser(user);
  if (!u.role || !ADMIN_ROLES.has(u.role)) throw new ForbiddenException('Storage admin role required');
  return u;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? 0)));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export function toRuleView(row: Record<string, unknown>): LifecycleRuleView {
  return {
    ruleId: String(row['ruleId'] ?? ''),
    prefix: String(row['prefix'] ?? ''),
    enabled: Boolean(row['enabled'] ?? true),
    expireDays: (row['expireDays'] as number | null | undefined) ?? null,
    abortIncompleteMultipartDays: Number(row['abortIncompleteMultipartDays'] ?? 1),
    description: (row['description'] as string | null | undefined) ?? null,
  };
}

export function toBudgetView(row: Record<string, unknown>): StorageBudgetView {
  return {
    tenantId: String(row['tenantId'] ?? ''),
    monthlyBudgetLimitTHB: num(row['monthlyBudgetLimitTHB']),
    warningThresholdPercent: num(row['warningThresholdPercent'] ?? 70),
    criticalThresholdPercent: num(row['criticalThresholdPercent'] ?? 85),
    notifyLineUserIds: (row['notifyLineUserIds'] as string[] | undefined) ?? [],
    autoPurgeTempOnExceed: Boolean(row['autoPurgeTempOnExceed'] ?? true),
  };
}

@Injectable()
export class StorageHandler {
  constructor(
    private readonly lifecycle: R2LifecycleService,
    private readonly budget: StorageBudgetService,
    private readonly db: StorageReadPort,
  ) {}

  async getStorageUsageMetrics(tenantId: string, user: StorageUser | undefined): Promise<StorageMetricView> {
    requireStorageUser(user);
    if (!tenantId) throw new BadRequestException('tenantId required');
    const row = await this.db.storageUsageMetric.findFirst({
      where: { tenantId },
      orderBy: { recordedAt: 'desc' },
    });
    return {
      totalSizeBytes: Number((row?.['totalSizeBytes'] as number | string | bigint | undefined) ?? 0),
      totalObjectsCount: Number(row?.['totalObjectsCount'] ?? 0),
      classAOperationsCount: Number((row?.['classAOperations'] as number | undefined) ?? (row?.['classAOperationsCount'] as number | undefined) ?? 0),
      classBOperationsCount: Number((row?.['classBOperations'] as number | undefined) ?? (row?.['classBOperationsCount'] as number | undefined) ?? 0),
      estimatedMonthlyCostTHB: num(row?.['estimatedCostTHB'] ?? row?.['estimatedMonthlyCostTHB'] ?? 0),
      recordedAt: row ? iso(row['recordedAt']) : new Date(0).toISOString(),
    };
  }

  async getR2LifecycleRules(bucketName: string, user: StorageUser | undefined): Promise<LifecycleRuleView[]> {
    requireStorageUser(user);
    if (!bucketName) throw new BadRequestException('bucketName required');
    const rows = await this.db.storageBucketPolicy.findMany({ where: { bucketName } });
    return rows.map(toRuleView);
  }

  async getStorageBudgetConfig(tenantId: string, user: StorageUser | undefined): Promise<StorageBudgetView> {
    requireStorageUser(user);
    const row = await this.db.storageBudgetAlertConfig.findUnique({ where: { tenantId } });
    if (!row) throw new BadRequestException('Budget config not found for tenant');
    return toBudgetView(row);
  }

  async updateR2LifecycleRules(bucketName: string, rules: LifecycleRuleInput[], user: StorageUser | undefined): Promise<boolean> {
    requireStorageAdmin(user);
    if (!bucketName) throw new BadRequestException('bucketName required');
    const parsed: R2LifecycleRule[] = (rules ?? []).map((r) =>
      R2LifecycleRuleSchema.parse({
        ruleId: r.ruleId,
        prefix: r.prefix,
        enabled: r.enabled,
        ...(r.expireDays === null || r.expireDays === undefined ? {} : { expireDays: r.expireDays }),
        ...(r.abortIncompleteMultipartDays === null || r.abortIncompleteMultipartDays === undefined
          ? {}
          : { abortIncompleteMultipartDays: r.abortIncompleteMultipartDays }),
        ...(r.description === null || r.description === undefined ? {} : { description: r.description }),
      }),
    );
    for (const r of parsed) {
      await this.db.storageBucketPolicy.upsert({
        where: { ruleId: r.ruleId },
        create: { tenantId: 'DEFAULT', bucketName, ...r },
        update: { bucketName, prefix: r.prefix, enabled: r.enabled, expireDays: r.expireDays ?? null, abortIncompleteMultipartDays: r.abortIncompleteMultipartDays, description: r.description ?? null },
      });
    }
    return this.lifecycle.syncBucketLifecycleRules(bucketName);
  }

  async updateStorageBudgetConfig(input: BudgetConfigInput, user: StorageUser | undefined): Promise<StorageBudgetView> {
    requireStorageAdmin(user);
    const parsed = StorageCostBudgetConfigSchema.parse({
      tenantId: input.tenantId,
      monthlyBudgetLimitTHB: input.monthlyBudgetLimitTHB,
      ...(input.warningThresholdPercent === null || input.warningThresholdPercent === undefined ? {} : { warningThresholdPercent: input.warningThresholdPercent }),
      ...(input.criticalThresholdPercent === null || input.criticalThresholdPercent === undefined ? {} : { criticalThresholdPercent: input.criticalThresholdPercent }),
      notifyLineUserIds: input.notifyLineUserIds,
      ...(input.autoPurgeTempOnExceed === null || input.autoPurgeTempOnExceed === undefined ? {} : { autoPurgeTempOnExceed: input.autoPurgeTempOnExceed }),
    });
    if (parsed.criticalThresholdPercent <= parsed.warningThresholdPercent) {
      throw new BadRequestException('criticalThresholdPercent must exceed warningThresholdPercent');
    }
    const row = await this.db.storageBudgetAlertConfig.upsert({
      where: { tenantId: parsed.tenantId },
      create: { ...parsed },
      update: { ...parsed },
    });
    return toBudgetView(row);
  }

  async triggerManualR2StorageCleanup(bucketName: string, prefix: string, user: StorageUser | undefined): Promise<number> {
    requireStorageAdmin(user);
    if (!bucketName || !prefix) throw new BadRequestException('bucketName and prefix required');
    // Manual lane: ensure a temp-purge rule covers the prefix, then sync.
    // Returns the synced enabled-rule count (R2 expiry itself is eventual).
    const ruleId = `manual-purge-${prefix.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)}`;
    await this.db.storageBucketPolicy.upsert({
      where: { ruleId },
      create: { tenantId: 'DEFAULT', bucketName, ruleId, prefix, enabled: true, expireDays: 1, abortIncompleteMultipartDays: 1 },
      update: { bucketName, prefix, enabled: true },
    });
    const rules = await this.lifecycle.enabledRules(bucketName);
    await this.lifecycle.syncBucketLifecycleRules(bucketName);
    return rules.length;
  }
}
