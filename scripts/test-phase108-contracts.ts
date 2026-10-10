// SSOT Phase 108 §10-11 — contract tests (Zod SSOT, quota matrix, helpers,
// provisioning/domain/quota logic with mocked Prisma/Redis, GQL SDL parity,
// Prisma Gate 1, frontend 5-state console).
// Run: npx tsx scripts/test-phase108-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CompanyStatusEnum,
  DomainVerificationStatusEnum,
  PackageTierEnum,
  CreateTenantPayloadSchema,
  TenantQuotaConfigSchema,
  UpdateTenantStatusSchema,
  QUOTA_MATRIX,
  DEFAULT_FEATURE_FLAGS,
  INGRESS_CNAME_TARGET,
  TENANT_EDGE_CACHE_TTL_SEC,
  TENANT_LIST_MAX_LIMIT,
  isServingStatus,
  statusChangeNeedsReason,
  quotaWarn,
  defaultSubdomainFor,
  isValidHostname,
} from '../packages/shared/src/schemas/tenant-orchestration.schema';
import { TenantProvisioningService } from '../apps/backend/src/modules/tenant-orchestration/services/tenant-provisioning.service';
import { DomainVerificationService } from '../apps/backend/src/modules/tenant-orchestration/services/domain-verification.service';
import { TenantQuotaEnforcerService } from '../apps/backend/src/modules/tenant-orchestration/services/tenant-quota-enforcer.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['PENDING_KYC', 'TRIAL_ACTIVE', 'TRIAL_EXPIRED', 'ACTIVE', 'SUSPENDED_PAYMENT_OVERDUE', 'SUSPENDED_POLICY_VIOLATION', 'MAINTENANCE']) {
    assert.equal(CompanyStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(CompanyStatusEnum.safeParse('ARCHIVED').success, false);
  for (const v of ['PENDING_DNS', 'PROVISIONING_SSL', 'ACTIVE', 'FAILED_DNS_NOT_FOUND', 'EXPIRED']) {
    assert.equal(DomainVerificationStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(DomainVerificationStatusEnum.safeParse('ACTIVE_SSL').success, false);
  for (const v of ['STARTER_FREE', 'PRO_CREATOR', 'ENTERPRISE_ACADEMY', 'CUSTOM_WHITE_LABEL']) {
    assert.equal(PackageTierEnum.safeParse(v).success, true, v);
  }
  assert.equal(PackageTierEnum.safeParse('FREE').success, false);
  assert.equal(
    CreateTenantPayloadSchema.safeParse({ companyName: 'Company Alpha', slug: 'company-alpha', packageTier: 'ENTERPRISE_ACADEMY', primaryContactEmail: 'admin@alpha.co' }).success,
    true,
  );
  assert.equal(
    CreateTenantPayloadSchema.safeParse({ companyName: 'A', slug: 'Bad_Slug!', packageTier: 'ENTERPRISE_ACADEMY', primaryContactEmail: 'nope' }).success,
    false,
  );
  assert.equal(
    TenantQuotaConfigSchema.safeParse({ maxUsers: 1, maxStorageBytes: 1, maxMonthlyLiffMAU: 1, enableCustomDomain: true, enableWhiteLabelLiff: false, enableAffiliateEngine: true }).success,
    true,
  );
  assert.equal(
    TenantQuotaConfigSchema.safeParse({ maxUsers: 0, maxStorageBytes: 1, maxMonthlyLiffMAU: 1, enableCustomDomain: true, enableWhiteLabelLiff: false, enableAffiliateEngine: true }).success,
    false,
  );
  assert.equal(UpdateTenantStatusSchema.safeParse({ tenantId: 't1', status: 'MAINTENANCE', reason: 'DB migration window' }).success, true);
  assert.equal(UpdateTenantStatusSchema.safeParse({ tenantId: '', status: 'ACTIVE' }).success, false);
  ok('1. Zod SSOT enums + payload schemas verbatim (§3.1)');
}

// ---------- 2. BDD quota matrix (Scenario 1: ENTERPRISE 1000GB/100000/3) ----------
{
  assert.equal(QUOTA_MATRIX.ENTERPRISE_ACADEMY.maxUsers, 100000);
  assert.equal(QUOTA_MATRIX.ENTERPRISE_ACADEMY.maxStorageBytes, BigInt(1000) * 1024n * 1024n * 1024n);
  assert.equal(QUOTA_MATRIX.ENTERPRISE_ACADEMY.maxMonthlyLiffMAU, 200000);
  assert.equal(QUOTA_MATRIX.ENTERPRISE_ACADEMY.maxCustomDomains, 3);
  assert.equal(QUOTA_MATRIX.STARTER_FREE.maxCustomDomains, 0);
  assert.equal(QUOTA_MATRIX.PRO_CREATOR.maxCustomDomains, 1);
  assert.equal(QUOTA_MATRIX.CUSTOM_WHITE_LABEL.maxCustomDomains, 10);
  assert.deepEqual(DEFAULT_FEATURE_FLAGS.STARTER_FREE, { customDomain: false, affiliate: true, whiteLabel: false });
  assert.equal(INGRESS_CNAME_TARGET, 'ingress.omnichannel-liff.com');
  assert.equal(TENANT_EDGE_CACHE_TTL_SEC, 86400);
  assert.equal(TENANT_LIST_MAX_LIMIT, 100);
  ok('2. BDD quota matrix + feature flags + constants');
}

// ---------- 3. Pure helpers ----------
{
  assert.equal(defaultSubdomainFor('company-alpha'), 'company-alpha.omnichannel-liff.com');
  assert.equal(isValidHostname('academy.company-alpha.com'), true);
  assert.equal(isValidHostname('not a domain'), false);
  assert.equal(isValidHostname('ab'), false);
  assert.equal(isServingStatus('ACTIVE'), true);
  assert.equal(isServingStatus('SUSPENDED_PAYMENT_OVERDUE'), false);
  assert.equal(statusChangeNeedsReason('SUSPENDED_PAYMENT_OVERDUE'), true);
  assert.equal(statusChangeNeedsReason('MAINTENANCE'), true);
  assert.equal(statusChangeNeedsReason('ACTIVE'), false);
  assert.equal(quotaWarn(91, 100), true);
  assert.equal(quotaWarn(89, 100), false);
  assert.equal(quotaWarn(950n, 1000n), true);
  ok('3. Pure helpers (subdomain/hostname/reason/warn/serving)');
}

// ---------- 4. Provisioning: happy path (mocked Prisma/Redis) ----------
function mockRedis() {
  const store = new Map<string, string>();
  const calls: { setex: number; del: number } = { setex: 0, del: 0 };
  return {
    store,
    calls,
    async setex(k: string, _t: number, v: string) { calls.setex++; store.set(k, v); },
    async get(k: string) { return store.get(k) ?? null; },
    async del(...ks: string[]) { calls.del += ks.length; for (const k of ks) store.delete(k); },
    async xaddPipeline() { /* best-effort sink */ },
  };
}

const COMPANY = {
  id: 'tenant-1', name: 'Company Alpha', slug: 'company-alpha',
  packageTier: 'ENTERPRISE_ACADEMY', contactEmail: 'admin@alpha.co',
  status: 'ACTIVE', primaryColor: '#10B981', maxUsers: 100000,
  maxStorageBytes: BigInt(1000) * 1024n * 1024n * 1024n, maxMonthlyLiffMAU: 200000,
  featureFlags: '{"customDomain":true}',
};

{
  const redis: any = mockRedis();
  const created: any = { company: null, domains: 0, subscription: false };
  const prisma: any = {
    tenantCompany: {
      async findUnique() { return null; },
      async update({ data }: any) { return { ...COMPANY, ...data }; },
      async findMany() { return []; },
      async count() { return 0; },
    },
    tenantCompanyDomain: {
      async findMany() { return []; },
    },
    $transaction: async (fn: any) => {
      const tx: any = {
        tenantCompany: { async create({ data }: any) { created.company = { id: COMPANY.id, ...data }; return created.company; } },
        tenantCompanyDomain: { async create() { created.domains++; return {}; } },
        tenantSubscription: { async create() { created.subscription = true; return {}; } },
      };
      return fn(tx);
    },
  };
  const svc = new TenantProvisioningService(prisma, redis);
  const out: any = await svc.provisionTenantCompany({
    companyName: 'Company Alpha', slug: 'company-alpha',
    packageTier: 'ENTERPRISE_ACADEMY', primaryContactEmail: 'admin@alpha.co',
  });
  assert.equal(out.slug, 'company-alpha');
  assert.equal(created.domains, 1); // default subdomain only (no customs)
  assert.equal(created.subscription, true); // Gate 7: subscription in same tx
  const cached = JSON.parse(redis.store.get('tenant:domain:company-alpha.omnichannel-liff.com')!);
  assert.equal(cached.tenantId, 'tenant-1');
  assert.equal(cached.status, 'ACTIVE');
  // Self-healing refill path: cold cache + ACTIVE domain re-caches on detail read.
  redis.store.clear();
  prisma.tenantCompany.findUnique = async () => ({
    ...COMPANY,
    domains: [{ domain: 'company-alpha.omnichannel-liff.com', status: 'ACTIVE' }],
    subscriptions: [], usageMetrics: [],
  });
  await svc.getTenantDetail('tenant-1');
  assert.ok(redis.store.has('tenant:domain:company-alpha.omnichannel-liff.com'));
  ok('4. Provisioning atomic tx + edge cache + self-healing refill');
}

// ---------- 5. Provisioning: duplicate slug + invalid payload + status guard ----------
{
  const redis: any = mockRedis();
  const prisma: any = {
    tenantCompany: {
      async findUnique() { return COMPANY; },
      async update({ data }: any) { return { ...COMPANY, ...data }; },
    },
    tenantCompanyDomain: { async findMany() { return []; } },
  };
  const svc = new TenantProvisioningService(prisma, redis);
  await assert.rejects(
    () => svc.provisionTenantCompany({ companyName: 'Dup', slug: 'company-alpha', packageTier: 'STARTER_FREE', primaryContactEmail: 'a@b.co' }),
    /already registered/,
  );
  await assert.rejects(
    () => svc.provisionTenantCompany({ companyName: 'X', slug: 'bad slug', packageTier: 'STARTER_FREE', primaryContactEmail: 'nope' }),
    /Invalid tenant provisioning payload/,
  );
  await assert.rejects(
    () => svc.updateTenantStatus('tenant-1', 'SUSPENDED_PAYMENT_OVERDUE'),
    /reason is required/,
  );
  const updated: any = await svc.updateTenantStatus('tenant-1', 'MAINTENANCE', 'DB migration window');
  assert.equal(updated.status, 'MAINTENANCE');
  const pkg: any = await svc.updateTenantPackage('tenant-1', 'PRO_CREATOR');
  assert.equal(pkg.maxUsers, 10000);
  ok('5. Duplicate slug 400 + Zod 400 + suspension reason guard + package switch');
}

// ---------- 6. Domain verifier: add/quota/verify-fail/purge (mocked) ----------
{
  const redis: any = mockRedis();
  const domains: any[] = [];
  const prisma: any = {
    tenantCompanyDomain: {
      async findFirst({ where }: any) { return domains.find((d) => d.tenantId === where.tenantId && d.domain === where.domain) ?? null; },
      async findUnique({ where }: any) { return domains.find((d) => d.domain === where.domain) ?? null; },
      async findMany({ where }: any) { return domains.filter((d) => d.tenantId === where.tenantId); },
      async create({ data }: any) { const row = { id: `dom-${domains.length}`, verifiedAt: null, ...data }; domains.push(row); return row; },
      async update({ where, data }: any) { const row = domains.find((d) => d.id === where.id); Object.assign(row, data); return row; },
      async count({ where }: any) { return domains.filter((d) => d.tenantId === where.tenantId && where.isPrimary === false ? !d.isPrimary : true).length; },
    },
    tenantCompany: { async findUnique() { return { ...COMPANY, packageTier: 'PRO_CREATOR' }; } },
  };
  const svc = new DomainVerificationService(prisma, redis);
  const added: any = await svc.addCustomDomain('tenant-1', 'academy.alpha.co');
  assert.equal(added.status, 'PENDING_DNS');
  assert.equal(added.cnameTarget, INGRESS_CNAME_TARGET);
  await assert.rejects(() => svc.addCustomDomain('tenant-1', 'academy.alpha.co'), /already registered/);
  await assert.rejects(() => svc.addCustomDomain('tenant-1', 'not a domain'), /Invalid domain format/);
  // Quota: PRO_CREATOR allows 1 custom domain — second add must fail.
  await assert.rejects(() => svc.addCustomDomain('tenant-1', 'second.alpha.co'), /quota exceeded/);
  // DNS failure path marks FAILED_DNS_NOT_FOUND (no live DNS in unit test).
  const failed: any = await svc.verifyCustomDomainDNS('tenant-1', 'academy.alpha.co');
  assert.equal(failed.status, 'FAILED_DNS_NOT_FOUND');
  assert.equal(failed.sslVerified, false);
  const purged: any = await svc.purgeTenantCache('tenant-1');
  assert.equal(purged.purged, 1);
  ok('6. Custom domain add/dedupe/quota/DNS-fail/purge');
}

// ---------- 7. Quota enforcer: warn flags + history + usage upsert ----------
{
  const redis: any = mockRedis();
  const prisma: any = {
    tenantCompany: { async findUnique() { return COMPANY; } },
    user: { async count() { return 95000; } }, // 95% of 100000 → warn
    tenantUsageMetric: {
      async aggregate() { return { _sum: { storageBytesUsed: BigInt(950) * 1024n * 1024n * 1024n } }; },
      async findFirst() { return { liffSessionsCount: 1000 }; },
      async findMany() { return [{ recordedDate: new Date('2026-10-01') }]; },
      async upsert() { return {}; },
    },
  };
  const svc = new TenantQuotaEnforcerService(prisma, redis);
  const all: any = await svc.getAllQuotaStatus('tenant-1');
  assert.equal(all.users.allowed, true);
  assert.equal(all.users.warning, true); // 95% ≥ 90%
  assert.equal(all.storage.warning, true);
  assert.equal(all.mau.warning, false);
  await svc.recordUsage('tenant-1', { activeUsers: 5 });
  const hist: any = await svc.getUsageHistory('tenant-1', 7);
  assert.equal(hist.length, 1);
  ok('7. Quota warn engine (90% predictive) + usage ledger');
}

// ---------- 8. Prisma Gate 1: models + enums present ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const token of ['model TenantCompany', 'model TenantCompanyDomain', 'model TenantSubscription', 'model TenantUsageMetric', 'enum CompanyStatus', 'enum DomainStatus', 'enum PackageTier', 'SUSPENDED_PAYMENT_OVERDUE', 'FAILED_DNS_NOT_FOUND', 'ENTERPRISE_ACADEMY']) {
    assert.ok(prisma.includes(token), token);
  }
  ok('8. Prisma SSOT models/enums (§4.1 Gate 1)');
}

// ---------- 9. GQL SDL parity (§3.2 intent names) ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/tenant/tenant-orchestration.graphql', 'utf8');
  for (const intent of ['getTenantsList', 'getTenantDetail', 'verifyDomainStatus', 'createTenantCompany', 'updateTenantStatus', 'updateTenantPackage', 'addTenantCustomDomain', 'purgeTenantCache', 'getTenantQuotaStatus']) {
    assert.ok(sdl.includes(intent), intent);
  }
  // Resolver source keeps GQL twins byte-identical to Zod (load-time drift guard).
  const resolver = readFileSync('apps/backend/src/modules/tenant-orchestration/resolvers/tenant-orchestration.resolver.ts', 'utf8');
  assert.ok(!resolver.includes('registerEnumType(CompanyStatusEnum'), 'must not register Zod schema as GQL enum');
  assert.ok(resolver.includes('enum CompanyStatusGql'), 'GQL twin enum required');
  ok('9. GQL SDL intents + resolver twin-enum guard');
}

// ---------- 10. Frontend 5-state console (§6.1) ----------
{
  const page = readFileSync('apps/frontend/app/(admin)/super-admin/tenants/page.tsx', 'utf8');
  for (const s of ['TENANT_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), s);
  }
  const hasDepImport = (src: string, dep: string) =>
    src.includes(`from '${dep}'`) || src.includes(`from "${dep}"`) || src.includes(`require('${dep}')`) || src.includes(`require("${dep}")`);
  assert.ok(!hasDepImport(page, 'date-fns'), 'zero-new-deps: no date-fns');
  const table = readFileSync('apps/frontend/components/super-admin/tenants/TenantListTable.tsx', 'utf8');
  assert.ok(!hasDepImport(table, 'date-fns'), 'zero-new-deps: no date-fns in table');
  const drawer = readFileSync('apps/frontend/components/super-admin/tenants/TenantProvisioningDrawer.tsx', 'utf8');
  assert.ok(!hasDepImport(drawer, 'lucide-react'), 'zero-new-deps: no lucide-react');
  const controller = readFileSync('apps/backend/src/modules/tenant-orchestration/controllers/tenant-orchestration.controller.ts', 'utf8');
  assert.ok(!hasDepImport(controller, '@nestjs/swagger'), 'zero-new-deps: no swagger');
  ok('10. Super-admin console 5-state + zero-new-deps guards');
}
} // end main()

main().then(() => {
  console.log(`\nPhase 108 contracts: ${passed}/10 check groups passed.`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
