// SSOT Phase 108 §3.1 — Multi-Tenant Orchestration Console contract
// Canonical: packages/shared/src/schemas/tenant-orchestration.schema.ts
// - Spec-verbatim: CompanyStatusEnum / DomainVerificationStatusEnum /
//   PackageTierEnum / CreateTenantPayloadSchema / TenantQuotaConfigSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - Prisma model for 108 custom domains is `TenantCompanyDomain` (NOT the
//     spec's `TenantDomain`): Phase 071 already owns `TenantDomain`
//     {domainName, isVerified} with pinned tests — a same-name model would
//     collide. GQL intent names stay spec-verbatim (§3.2).
//   - slug allows min(1) (spec regex verbatim kept); tenantId/id accept min(1)
//     edge vocabulary (Phase 023-031 precedent).
// - Zero new deps (zod only).
import { z } from 'zod';

export const CompanyStatusEnum = z.enum([
  'PENDING_KYC',
  'TRIAL_ACTIVE',
  'TRIAL_EXPIRED',
  'ACTIVE',
  'SUSPENDED_PAYMENT_OVERDUE',
  'SUSPENDED_POLICY_VIOLATION',
  'MAINTENANCE',
]);
export type CompanyStatus = z.infer<typeof CompanyStatusEnum>;

export const DomainVerificationStatusEnum = z.enum([
  'PENDING_DNS',
  'PROVISIONING_SSL',
  'ACTIVE',
  'FAILED_DNS_NOT_FOUND',
  'EXPIRED',
]);
export type DomainVerificationStatus = z.infer<typeof DomainVerificationStatusEnum>;

export const PackageTierEnum = z.enum([
  'STARTER_FREE',
  'PRO_CREATOR',
  'ENTERPRISE_ACADEMY',
  'CUSTOM_WHITE_LABEL',
]);
export type PackageTier = z.infer<typeof PackageTierEnum>;

export const CreateTenantPayloadSchema = z.object({
  companyName: z.string().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric + hyphens'),
  packageTier: PackageTierEnum,
  primaryContactEmail: z.string().email(),
  customDomains: z.array(z.string().min(3).max(253)).optional(),
});
export type CreateTenantPayload = z.infer<typeof CreateTenantPayloadSchema>;

export const TenantQuotaConfigSchema = z.object({
  maxUsers: z.number().int().positive(),
  maxStorageBytes: z.number().int().positive(),
  maxMonthlyLiffMAU: z.number().int().positive(),
  enableCustomDomain: z.boolean(),
  enableWhiteLabelLiff: z.boolean(),
  enableAffiliateEngine: z.boolean(),
});
export type TenantQuotaConfig = z.infer<typeof TenantQuotaConfigSchema>;

export const UpdateTenantStatusSchema = z.object({
  tenantId: z.string().min(1),
  status: CompanyStatusEnum,
  reason: z.string().min(5).max(255).optional(),
});
export type UpdateTenantStatus = z.infer<typeof UpdateTenantStatusSchema>;

/** BDD Scenario 1 quota matrix (ENTERPRISE: 1000GB / 100000 users / 3 domains). */
export const QUOTA_MATRIX: Record<
  PackageTier,
  { maxUsers: number; maxStorageBytes: bigint; maxMonthlyLiffMAU: number; maxCustomDomains: number; monthlyFee: number }
> = {
  STARTER_FREE: { maxUsers: 1000, maxStorageBytes: BigInt(10) * 1024n * 1024n * 1024n, maxMonthlyLiffMAU: 5000, maxCustomDomains: 0, monthlyFee: 0 },
  PRO_CREATOR: { maxUsers: 10000, maxStorageBytes: BigInt(100) * 1024n * 1024n * 1024n, maxMonthlyLiffMAU: 25000, maxCustomDomains: 1, monthlyFee: 1490 },
  ENTERPRISE_ACADEMY: { maxUsers: 100000, maxStorageBytes: BigInt(1000) * 1024n * 1024n * 1024n, maxMonthlyLiffMAU: 200000, maxCustomDomains: 3, monthlyFee: 14900 },
  CUSTOM_WHITE_LABEL: { maxUsers: 999999, maxStorageBytes: BigInt(5000) * 1024n * 1024n * 1024n, maxMonthlyLiffMAU: 1000000, maxCustomDomains: 10, monthlyFee: 49900 },
};

export const DEFAULT_FEATURE_FLAGS: Record<PackageTier, { customDomain: boolean; affiliate: boolean; whiteLabel: boolean }> = {
  STARTER_FREE: { customDomain: false, affiliate: true, whiteLabel: false },
  PRO_CREATOR: { customDomain: true, affiliate: true, whiteLabel: false },
  ENTERPRISE_ACADEMY: { customDomain: true, affiliate: true, whiteLabel: true },
  CUSTOM_WHITE_LABEL: { customDomain: true, affiliate: true, whiteLabel: true },
};

export const INGRESS_CNAME_TARGET = 'ingress.omnichannel-liff.com';
export const DEFAULT_SUBDOMAIN_SUFFIX = '.omnichannel-liff.com';
export const TENANT_EDGE_CACHE_TTL_SEC = 86400;
export const QUOTA_WARN_RATIO = 0.9;
export const TENANT_LIST_MAX_LIMIT = 100;

/** Statuses that fail-closed the 071 TenantGuard (anything but ACTIVE ⇒ 401). */
export function isServingStatus(status: string): boolean {
  return status === 'ACTIVE';
}

/** Suspension transitions require an audit reason (lifecycle switcher guard). */
export function statusChangeNeedsReason(status: CompanyStatus): boolean {
  return status === 'SUSPENDED_PAYMENT_OVERDUE' || status === 'SUSPENDED_POLICY_VIOLATION' || status === 'MAINTENANCE';
}

/** Quota usage ratio → warn when ≥90% (predictive alert engine §7.1). */
export function quotaWarn(used: number | bigint, max: number | bigint): boolean {
  const ratio = Number(used) / Number(max);
  return Number.isFinite(ratio) && ratio >= QUOTA_WARN_RATIO;
}

export function defaultSubdomainFor(slug: string): string {
  return `${slug}${DEFAULT_SUBDOMAIN_SUFFIX}`;
}

export function isValidHostname(domain: string): boolean {
  if (typeof domain !== 'string' || domain.length < 3 || domain.length > 253) return false;
  return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(domain);
}
