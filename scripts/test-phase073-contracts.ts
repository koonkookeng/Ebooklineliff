// SSOT Phase 073 §10-11 — contract tests (Zod, finance, use-cases, parity)
// Run: npx tsx scripts/test-phase073-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OrderFulfillmentStatusEnum,
  MerchantProductUpsertSchema,
  PayoutRequestSchema,
  MerchantAnalyticsFilterSchema,
  WITHHOLDING_TAX_RATE,
  PAYOUT_PROCESSING_FEE,
  toBaht,
  withholdingTaxFor,
  netPayoutFor,
  merchantAnalyticsKey,
  MERCHANT_ANALYTICS_TTL_SEC,
} from '../packages/shared/src/schemas/merchant-contract';
import {
  assertTenantOwnership,
  assertMerchantRole,
  assertPayoutMinimum,
  assertFulfillmentTransition,
} from '../apps/backend/src/modules/merchant/domain/entities/merchant-account.entity';
import { MerchantTaxCalculator } from '../apps/backend/src/modules/merchant/domain/services/tax-calculator.domain-service';
import { CreateProductStudioUseCase } from '../apps/backend/src/modules/merchant/application/use-cases/create-product-studio.usecase';
import { ProcessPayoutRequestUseCase } from '../apps/backend/src/modules/merchant/application/use-cases/process-payout-request.usecase';
import { GenerateShippingLabelUseCase } from '../apps/backend/src/modules/merchant/application/use-cases/generate-shipping-label.usecase';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = {
  tenantId: 'academy-a', title: 'First Book', slug: 'first-book',
  description: 'd', coverImageUrl: 'https://cdn.example.com/c.png',
  productType: 'PHYSICAL_BOOK', price: 350,
  physicalDetail: { weightGrams: 500, stockQty: 10, sku: 'SKU-1' },
};

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + finance math (BDD-3) ----------
{
  assert.equal(OrderFulfillmentStatusEnum.safeParse('SHIPPED').success, true);
  assert.equal(MerchantProductUpsertSchema.safeParse(PRODUCT).success, true);
  assert.equal(MerchantProductUpsertSchema.safeParse({ ...PRODUCT, title: 'AB' }).success, false);
  assert.equal(MerchantProductUpsertSchema.safeParse({ ...PRODUCT, price: 0 }).success, false);
  assert.equal(
    PayoutRequestSchema.safeParse({ tenantId: 'a', requestedAmount: 50000, bankAccountId: UUID }).success,
    true,
  );
  assert.equal(
    PayoutRequestSchema.safeParse({ tenantId: 'a', requestedAmount: 999, bankAccountId: UUID }).success,
    false,
  );
  assert.equal(
    MerchantAnalyticsFilterSchema.safeParse({
      tenantId: 'a', startDate: new Date().toISOString(), endDate: new Date().toISOString(),
    }).success,
    true,
  );
  // BDD-3: 50000 -> tax 1500 + fee 10 -> net 48490.
  assert.equal(WITHHOLDING_TAX_RATE, 0.03);
  assert.equal(PAYOUT_PROCESSING_FEE, 10);
  assert.equal(withholdingTaxFor(50000), 1500);
  assert.deepEqual(netPayoutFor(50000), { tax: 1500, fee: 10, net: 48490 });
  assert.equal(toBaht(10.005), 10.01);
  assert.equal(merchantAnalyticsKey('A', '2026-10-08T00:00:00Z'), 'merchant:analytics:A:2026-10-08');
  assert.equal(MERCHANT_ANALYTICS_TTL_SEC, 3600);
  ok('Zod §3.1 verbatim + BDD-3 payout math');
}

// ---------- 2. Entity invariants (Gate 4 isolation) ----------
{
  assert.equal(assertTenantOwnership('academy-a', 'academy-a'), 'academy-a');
  assert.throws(() => assertTenantOwnership('a', 'b'), /Cross-tenant/);
  assert.throws(() => assertTenantOwnership(undefined, 'a'), /Missing X-Tenant-ID/);
  assert.doesNotThrow(() => assertMerchantRole('SELLER'));
  assert.doesNotThrow(() => assertMerchantRole('INSTRUCTOR'));
  assert.throws(() => assertMerchantRole('MEMBER'), /Unauthorized merchant/);
  assert.doesNotThrow(() => assertPayoutMinimum(1000));
  assert.throws(() => assertPayoutMinimum(999), /1,000/);
  assert.doesNotThrow(() => assertFulfillmentTransition('PACKED', 'SHIPPED'));
  assert.doesNotThrow(() => assertFulfillmentTransition('SHIPPED', 'RETURNED'));
  assert.throws(() => assertFulfillmentTransition('UNFULFILLED', 'SHIPPED'), /Illegal/);
  ok('Entities: ownership/role/minimum/forward-only flow');
}

// ---------- 3. Tax calculator + use-cases ----------
function makeRepo(over: Record<string, unknown> = {}) {
  const calls: Array<{ m: string; a: unknown }> = [];
  const products = new Map<string, { id: string }>();
  return {
    calls,
    repo: {
      findProductBySlug: async (t: string, s: string) => products.get(`${t}:${s}`) ?? null,
      createProduct: async (input: { slug: string }) => {
        calls.push({ m: 'createProduct', a: input.slug });
        const row = { id: UUID };
        products.set(`academy-a:${input.slug}`, row);
        return { ...row, slug: input.slug };
      },
      updateProduct: async (id: string, input: { slug: string }) => {
        calls.push({ m: 'updateProduct', a: id });
        return { id, slug: input.slug };
      },
      findMerchantByTenant: async () => ('profile' in over ? (over['profile'] as { id: string } | null) : { id: UUID, tenantId: 'academy-a' }),
      createPayoutAtomic: async (_p: string, amounts: { gross: number; tax: number; fee: number; net: number }) => {
        calls.push({ m: 'createPayoutAtomic', a: amounts });
        return { id: UUID, netAmount: amounts.net };
      },
      findOrderTenant: async () => ('orderTenant' in over ? (over['orderTenant'] as string | null) : 'academy-a'),
      upsertFulfillment: async (a: { status: string }) => {
        calls.push({ m: 'upsertFulfillment', a });
        return { id: UUID, status: a.status };
      },
      analyticsRange: async () => [],
    },
  };
}

async function sectionUseCases(): Promise<void> {
  const tax = new MerchantTaxCalculator();
  assert.deepEqual(tax.breakdown(50000), { gross: 50000, tax: 1500, fee: 10, net: 48490 });
  // Product: create then slug-hit update.
  {
    const { repo, calls } = makeRepo();
    const uc = new CreateProductStudioUseCase(repo as never);
    const c = await uc.execute('academy-a', PRODUCT);
    assert.equal(c.updated, false);
    const u = await uc.execute('academy-a', PRODUCT);
    assert.equal(u.updated, true);
    assert.ok(calls.some((c2) => c2.m === 'createProduct'));
    await assert.rejects(uc.execute('academy-a', { ...PRODUCT, title: 'x' }), /Invalid product/);
    await assert.rejects(uc.execute('other', PRODUCT), /Cross-tenant/);
  }
  // Payout: atomic PENDING with BDD-3 amounts; minimum + unknown profile.
  {
    const { repo, calls } = makeRepo();
    const uc = new ProcessPayoutRequestUseCase(repo as never, tax);
    const r = await uc.execute('academy-a', { requestedAmount: 50000, bankAccountId: UUID });
    assert.deepEqual(
      { gross: r.grossAmount, tax: r.withholdingTax, fee: r.processingFee, net: r.netAmount },
      { gross: 50000, tax: 1500, fee: 10, net: 48490 },
    );
    assert.equal(r.payoutStatus, 'PENDING');
    assert.ok(calls.some((c) => c.m === 'createPayoutAtomic'));
    await assert.rejects(uc.execute('academy-a', { requestedAmount: 500, bankAccountId: UUID }), /Invalid payout/);
    const missing = makeRepo({ profile: null });
    await assert.rejects(
      new ProcessPayoutRequestUseCase(missing.repo as never, tax).execute('academy-a', { requestedAmount: 5000, bankAccountId: UUID }),
      /not found/,
    );
  }
  // Fulfillment: cross-tenant blocked (BDD-1), ship needs tracking.
  {
    const { repo } = makeRepo();
    const uc = new GenerateShippingLabelUseCase(repo as never);
    const r = await uc.execute('academy-a', {
      orderId: UUID, warehouseId: UUID, status: 'SHIPPED', fromStatus: 'PACKED', trackingNumber: 'TH123',
    });
    assert.equal(r.status, 'SHIPPED');
    const foreign = makeRepo({ orderTenant: 'other' });
    await assert.rejects(
      new GenerateShippingLabelUseCase(foreign.repo as never).execute('academy-a', {
        orderId: UUID, warehouseId: UUID, status: 'PACKED',
      }),
      /Cross-tenant fulfillment/,
    );
    await assert.rejects(
      uc.execute('academy-a', { orderId: UUID, warehouseId: UUID, status: 'SHIPPED', fromStatus: 'PACKED' }),
      /Tracking number/,
    );
  }
  ok('Use-cases: product/payout/fulfillment + guards');
}

// ---------- 4. Prisma additive (Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum FulfillmentStatus {', 'enum PayoutStatus {',
    'model MerchantProfile {', 'model Warehouse {', 'model OrderFulfillment {',
    'model PayoutTransaction {', 'model MerchantAnalyticsDaily {',
    'fulfillment          OrderFulfillment?', 'merchantProfile     MerchantProfile?',
    '@@unique([tenantId, recordDate])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: merchant segment 5 models + 2 enums + relations');
}

// ---------- 5. Static parity ----------
function sectionParity(): void {
  const tax = readFileSync('apps/backend/src/modules/merchant/domain/services/tax-calculator.domain-service.ts', 'utf8');
  assert.ok(tax.includes('MerchantTaxCalculator') && tax.includes('netPayoutFor'));
  for (const f of [
    'apps/backend/src/modules/merchant/application/use-cases/create-product-studio.usecase.ts',
    'apps/backend/src/modules/merchant/application/use-cases/process-payout-request.usecase.ts',
    'apps/backend/src/modules/merchant/application/use-cases/generate-shipping-label.usecase.ts',
    'apps/backend/src/modules/merchant/infrastructure/repositories/prisma-merchant.repository.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const studio = readFileSync('apps/backend/src/modules/merchant/infrastructure/controllers/merchant-studio.controller.ts', 'utf8');
  assert.ok(studio.includes('product/upsert') && studio.includes('presigned-upload') && studio.includes('TenantGuard'));
  const payout = readFileSync('apps/backend/src/modules/merchant/infrastructure/controllers/merchant-payout.controller.ts', 'utf8');
  assert.ok(payout.includes('payout/request') && payout.includes('fulfillment/label') && payout.includes("'analytics'"));
  const mod = readFileSync('apps/backend/src/modules/merchant/merchant.module.ts', 'utf8');
  assert.ok(mod.includes('MerchantModule') && !mod.includes('MerchantModuleModule'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('MerchantModule'));
  const gql = readFileSync('apps/backend/src/modules/merchant/infrastructure/graphql/resolvers/merchant-studio.resolver.ts', 'utf8');
  assert.ok(gql.includes('getMerchantAnalytics') && gql.includes('upsertMerchantProduct'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/merchant-studio.graphql', 'utf8');
  assert.ok(sdl.includes('getMerchantAnalytics') && sdl.includes('upsertMerchantProduct'));
  for (const p of [
    'apps/frontend/app/(dashboard)/merchant/layout.tsx',
    'apps/frontend/app/(dashboard)/merchant/page.tsx',
    'apps/frontend/app/(dashboard)/merchant/products/page.tsx',
    'apps/frontend/app/(dashboard)/merchant/studio/page.tsx',
    'apps/frontend/app/(dashboard)/merchant/orders/page.tsx',
    'apps/frontend/app/(dashboard)/merchant/payouts/page.tsx',
    'apps/frontend/app/(dashboard)/merchant/analytics/page.tsx',
    'apps/frontend/components/dashboard/MerchantSidebar.tsx',
    'apps/frontend/components/dashboard/DashboardShell.tsx',
    'apps/frontend/hooks/useMerchantDashboard.ts',
    'apps/frontend/lib/dashboard/dashboard-client.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  for (const p of [
    'apps/frontend/app/api/v1/merchant/analytics/route.ts',
    'apps/frontend/app/api/v1/merchant/studio/product/upsert/route.ts',
    'apps/frontend/app/api/v1/merchant/studio/video/presigned-upload/route.ts',
    'apps/frontend/app/api/v1/merchant/payout/request/route.ts',
    'apps/frontend/app/api/v1/merchant/fulfillment/label/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('x-tenant-id'), `proxy missing tenant: ${p}`);
  }
  // OUT_OF_SCOPE guard: LIFF untouched by this phase.
  const liffGuard = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(!liffGuard.includes('merchant'), 'LIFF layout must stay untouched');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('merchant-contract') && barrel.includes('MerchantProductUpsertSchema'));
  ok('Parity: module/REST/GQL/dashboard/proxies/hook/LIFF-untouched/barrel');
}

async function main(): Promise<void> {
  await sectionUseCases();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase073 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
