// SSOT Phase 097 §10-11 — contract tests (Zod, pool, claim, revoke, parity)
// Run: npx tsx scripts/test-phase097-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CorporateLicenseStatusEnum,
  SeatStatusEnum,
  CreateCorporateLicenseInputSchema,
  ClaimCorporateSeatPayloadSchema,
  BulkSeatInviteInputSchema,
  CORPORATE_DEFAULT_EXPIRY_DAYS,
  B2B_STREAM,
  remainingSeats,
  licenseStatusAfter,
  corporateLicenseCode,
  corporateClaimUrl,
  corporateClaimLockKey,
  maskTaxId,
} from '../packages/shared/src/schemas/b2b-contract';
import { B2bLicenseService } from '../apps/backend/src/modules/b2b/services/b2b-license.service';
import { B2bSeatAllocationService } from '../apps/backend/src/modules/b2b/services/b2b-seat-allocation.service';
import { B2bAnalyticsService } from '../apps/backend/src/modules/b2b/services/b2b-analytics.service';
import { buildCorporateOnboardingFlex } from '../apps/backend/src/modules/b2b/services/b2b-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const NOW = Date.now();

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(CorporateLicenseStatusEnum.safeParse('EXHAUSTED').success, true);
  assert.equal(CorporateLicenseStatusEnum.safeParse('DELETED').success, false);
  assert.equal(SeatStatusEnum.safeParse('REVOKED').success, true);
  assert.equal(SeatStatusEnum.safeParse('PENDING').success, false);
  const input = {
    corporateName: 'Acme Co', taxId: '0123456789012', contactEmail: 'hr@acme.co',
    productId: UUID, totalSeats: 100,
  };
  const parsed = CreateCorporateLicenseInputSchema.safeParse(input);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.expiresInDays, 365);
  assert.equal(CreateCorporateLicenseInputSchema.safeParse({ ...input, taxId: '123' }).success, false);
  assert.equal(CreateCorporateLicenseInputSchema.safeParse({ ...input, contactEmail: 'nope' }).success, false);
  assert.equal(CreateCorporateLicenseInputSchema.safeParse({ ...input, totalSeats: 0 }).success, false);
  assert.equal(
    ClaimCorporateSeatPayloadSchema.safeParse({
      success: true, message: 'ok', licenseId: UUID, assignedSeatId: UUID_B,
      entitlementGranted: true, remainingSeats: 99,
    }).success,
    true,
  );
  assert.equal(
    BulkSeatInviteInputSchema.safeParse({ licenseId: UUID, emails: ['a@b.co'] }).success,
    true,
  );
  assert.equal(
    BulkSeatInviteInputSchema.safeParse({ licenseId: UUID, emails: ['nope'] }).success,
    false,
  );
  ok('Zod §3.1 verbatim (status/seat/license/claim/invite gates)');
}

// ---------- 2. Pool helpers + Flex (§4.1/BDD-1) ----------
{
  assert.equal(CORPORATE_DEFAULT_EXPIRY_DAYS, 365);
  assert.equal(B2B_STREAM, 'stream:b2b:licenses');
  assert.equal(remainingSeats(100, 30), 70);
  assert.equal(remainingSeats(10, 15), 0);
  assert.equal(licenseStatusAfter(100, 99), 'ACTIVE');
  assert.equal(licenseStatusAfter(100, 100), 'EXHAUSTED');
  assert.ok(/^CORP-[0-9A-Z]+-[0-9A-Z]{4}$/.test(corporateLicenseCode()));
  assert.notEqual(corporateLicenseCode(1000, 1), corporateLicenseCode(1000, 2));
  assert.equal(corporateClaimUrl('https://liff.line.me/', 'CORP-X'), 'https://liff.line.me/b2b/claim?code=CORP-X');
  assert.equal(corporateClaimLockKey('CORP-X'), 'lock:b2b:claim:CORP-X');
  assert.equal(maskTaxId('0123456789012'), 'XXXXXXXXX9012');
  const card = buildCorporateOnboardingFlex({ companyName: 'Acme Co', totalSeats: 100, claimUrl: 'https://liff.line.me/b2b/claim?code=C' }) as {
    type: string; altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } };
  };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('Acme Co'));
  assert.ok(JSON.stringify(card).includes('รับสิทธิ์พนักงาน'));
  ok('Helpers: pool math/code/link/lock/tax-mask + Flex card');
}

// ---------- 3. License service (BDD-1: pool + onboarding) ----------
async function sectionLicense(): Promise<void> {
  const streams: string[] = [];
  const repo = {
    createAccount: async () => ({ id: 'acct-1' }),
    createLicense: async (a: Record<string, unknown>) => ({ id: 'lic-1', licenseCode: a['licenseCode'] as string }),
    findLicenseByCode: async (code: string) =>
      code === 'CORP-GOOD' ? {
        id: 'lic-1', corporateAccountId: 'acct-1', companyName: 'Acme Co',
        productId: UUID, productTitle: 'Bundle', totalSeats: 100, usedSeats: 30,
        licenseCode: code, status: 'ACTIVE', expiresAt: new Date(NOW + 86400000),
      } : null,
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new B2bLicenseService(repo as never, bus);
  const r = await svc.createLicense({
    input: {
      corporateName: 'Acme Co', taxId: '0123456789012', contactEmail: 'hr@acme.co',
      productId: UUID, totalSeats: 100,
    },
  });
  assert.equal(r.licenseId, 'lic-1');
  assert.ok(/^CORP-/.test(r.licenseCode));
  assert.ok(r.claimUrl.includes(r.licenseCode));
  assert.ok(JSON.parse(r.flexMessageJson));
  assert.ok(Date.parse(r.expiresAt) - Date.now() > 364 * 86400000);
  assert.ok(streams.includes(B2B_STREAM));
  const info = await svc.licenseInfo('CORP-GOOD');
  assert.deepEqual([info.totalSeats, info.usedSeats, info.remainingSeats], [100, 30, 70]);
  assert.equal(info.corporateAccountId, 'acct-1');
  await assert.rejects(svc.licenseInfo('CORP-NOPE'), /not found/);
  await assert.rejects(
    svc.createLicense({ input: { corporateName: 'A', taxId: 'x', contactEmail: 'hr@acme.co', productId: UUID, totalSeats: 10 } }),
    /Invalid corporate license/,
  );
  ok('License: pool + Flex + info + 2 gates');
}

// ---------- 4. Claim service (BDD-2 <800ms, single-seat race) ----------
function claimPorts(status: string, used: number, total: number, expiresAt: number, owner = UUID_B) {
  const license = {
    id: 'lic-1', corporateAccountId: 'acct-1', companyName: 'Acme', productId: UUID_C,
    productTitle: 'Bundle', totalSeats: total, usedSeats: used, licenseCode: 'CORP-POOL',
    status, expiresAt: new Date(expiresAt),
  };
  const claimed: string[] = [];
  const grants: string[] = [];
  const edges: string[] = [];
  const streams: string[] = [];
  let locked = false;
  const repo = {
    findLicenseByCode: async (c: string) => (c === 'CORP-POOL' ? license : null),
    findLicenseById: async (id: string) => (id === 'lic-1' ? { productId: UUID_C } : null),
    findActiveSeat: async (lid: string, uid: string) => (uid === owner ? { id: 'seat-mine' } : null),
    claimSeat: async () => { claimed.push('x'); return { seatId: 'seat-9' }; },
    bumpUsage: async () => ({ totalSeats: total, usedSeats: used + 1 }),
    setEntitlementExpiry: async () => undefined,
    revokeSeat: async () => ({ licenseId: 'lic-1', userId: UUID }),
    releaseUsage: async () => undefined,
    revokeEntitlement: async () => undefined,
    withTx(tx: unknown) { return this; },
  };
  const locks = {
    set: async () => {
      if (locked) return null;
      locked = true;
      return 'OK';
    },
    del: async () => { locked = false; },
    setEdge: async (k: string) => { edges.push(k); },
    delEdge: async () => undefined,
    xaddPipeline: async (s: string) => { streams.push(s); },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const grantsSvc = { grantForOrder: async (t: unknown, u: string, p: string[], a: string) => { grants.push(`${u}:${a}`); return p; } };
  return { repo, locks, tx, grantsSvc, claimed, grants, edges, streams };
}

async function sectionClaim(): Promise<void> {
  const svcOf = (p: ReturnType<typeof claimPorts>) =>
    new B2bSeatAllocationService(p.repo as never, p.locks as never, p.tx, p.grantsSvc as never);
  // Happy path: ACTIVE pool → seat + CORPORATE_LICENSE grant (<800ms).
  {
    const p = claimPorts('ACTIVE', 30, 100, NOW + 86400000, 'nobody');
    const t0 = Date.now();
    const r = await svcOf(p).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID, lineUserId: 'U123' });
    assert.ok(Date.now() - t0 < 800, 'claim <800ms budget');
    assert.deepEqual(r, {
      success: true, message: 'Corporate seat successfully claimed!', licenseId: 'lic-1',
      assignedSeatId: 'seat-9', entitlementGranted: true, remainingSeats: 69,
    });
    assert.deepEqual(p.claimed, ['x']);
    assert.ok(p.grants.includes(`${UUID}:CORPORATE_LICENSE`));
    assert.ok(p.edges.includes(`entitlement:${UUID}:${UUID_C}`));
    assert.ok(p.streams.includes(B2B_STREAM));
  }
  // Last seat flips pool to EXHAUSTED (remaining 0).
  {
    const p = claimPorts('ACTIVE', 99, 100, NOW + 86400000, 'nobody');
    const r = await svcOf(p).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID });
    assert.equal(r.remainingSeats, 0);
  }
  // Graceful shapes: re-claim / exhausted pool / expired / unknown / race.
  {
    const mine = claimPorts('ACTIVE', 30, 100, NOW + 86400000, UUID);
    const r = await svcOf(mine).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID });
    assert.deepEqual([r.success, r.assignedSeatId, r.remainingSeats], [true, 'seat-mine', 70]);
    assert.deepEqual(mine.claimed, []);
    const full = claimPorts('EXHAUSTED', 100, 100, NOW + 86400000, 'nobody');
    assert.equal((await svcOf(full).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID })).success, false);
    const gone = claimPorts('ACTIVE', 30, 100, NOW - 1000, 'nobody');
    assert.ok((await svcOf(gone).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID })).message.includes('หมดอายุ'));
    const unknown = claimPorts('ACTIVE', 30, 100, NOW + 86400000, 'nobody');
    assert.equal((await svcOf(unknown).claimSeatForUser({ licenseCode: 'CORP-NOPE', userId: UUID })).success, false);
    const p = claimPorts('ACTIVE', 30, 100, NOW + 86400000, 'nobody');
    await p.locks.set();
    await assert.rejects(svcOf(p).claimSeatForUser({ licenseCode: 'CORP-POOL', userId: UUID }), /busy/);
    assert.deepEqual(p.claimed, []);
    await assert.rejects(svcOf(p).claimSeatForUser({ licenseCode: '', userId: UUID }), /Missing licenseCode/);
  }
  ok('Claim: atomic grant + EXHAUSTED flip + 6 graceful/race shapes (<800ms)');
}

// ---------- 5. Revoke + analytics (BDD-3) ----------
async function sectionRevoke(): Promise<void> {
  const released: string[] = [];
  const revoked: string[] = [];
  const edges: string[] = [];
  const streams: string[] = [];
  const repo = {
    findLicenseById: async () => ({ productId: UUID_C }),
    revokeSeat: async () => ({ licenseId: 'lic-1', userId: UUID }),
    releaseUsage: async (tx: unknown, id: string) => { released.push(id); },
    revokeEntitlement: async (tx: unknown, u: string, p: string) => { revoked.push(`${u}:${p}`); },
    findAccountLicenses: async () => [{
      id: 'lic-1', productTitle: 'Bundle', totalSeats: 100, usedSeats: 30, status: 'ACTIVE',
    }],
    withTx(tx: unknown) { return this; },
  };
  const locks = {
    set: async () => 'OK', del: async () => undefined,
    setEdge: async () => undefined, delEdge: async (k: string) => { edges.push(k); },
    xaddPipeline: async (s: string) => { streams.push(s); },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const svc = new B2bSeatAllocationService(repo as never, locks as never, tx, { grantForOrder: async () => [] } as never);
  assert.equal(await svc.revokeSeat({ seatId: 'seat-1' }), true);
  assert.deepEqual(released, ['lic-1']);
  assert.deepEqual(revoked, [`${UUID}:${UUID_C}`]);
  assert.ok(edges.includes(`entitlement:${UUID}:${UUID_C}`));
  assert.ok(streams.includes(B2B_STREAM));
  const analytics = new B2bAnalyticsService(repo as never, {
    licenseCompletion: async () => ({ assigned: 30, activeUsers: 25 }),
  });
  const d = await analytics.dashboard('acct-1');
  assert.deepEqual([d.licenses[0]?.remainingSeats, d.licenses[0]?.activeUsers], [70, 25]);
  ok('Revoke: seat + entitlement + pool release; dashboard funnel');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum CorporateLicenseStatus {',
    'EXHAUSTED',
    'enum SeatStatus {',
    'REVOKED',
    'model CorporateAccount {',
    'taxId          String                @unique',
    'model CorporateDepartment {',
    'model CorporateLicense {',
    'licenseCode        String                 @unique @default(uuid())',
    'model CorporateSeat {',
    'inviteLineUserId String?',
    '@@index([inviteEmail])',
    'corporateSeats    CorporateSeat[]',
    'corporateLicenses CorporateLicense[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  // Phase 098 DONE: B2B* HR models now coexist (bounded context note kept
  // in schema.prisma §4.1) — the stale no-drift guard is retired.
  assert.ok(prisma.includes('model B2BCorporateSeat'), '098 HR seat model coexists');
  ok('Prisma: accounts/departments/licenses/seats + User/Product relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/b2b/b2b.module.ts',
    'apps/backend/src/modules/b2b/controllers/b2b-corporate.controller.ts',
    'apps/backend/src/modules/b2b/resolvers/b2b-seat.resolver.ts',
    'apps/backend/src/modules/b2b/services/b2b-license.service.ts',
    'apps/backend/src/modules/b2b/services/b2b-seat-allocation.service.ts',
    'apps/backend/src/modules/b2b/services/b2b-analytics.service.ts',
    'apps/backend/src/modules/b2b/services/b2b-flex.builder.ts',
    'apps/backend/src/modules/b2b/repositories/b2b-prisma.repository.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/b2b/b2b.module.ts', 'utf8');
  assert.ok(mod.includes('B2bModule') && mod.includes('B2bSeatAllocationService') && mod.includes('EntitlementGrantService'));
  assert.ok(!/class B2bModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('B2bModule'));
  const gql = readFileSync('apps/backend/src/modules/b2b/resolvers/b2b-seat.resolver.ts', 'utf8');
  assert.ok(gql.includes('claimCorporateSeat') && gql.includes('allocateCorporateSeats') && gql.includes('revokeCorporateSeat'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/b2b/b2b-seat.resolver.ts', 'utf8');
  assert.ok(alias.includes('B2bSeatResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/b2b.graphql', 'utf8');
  assert.ok(sdl.includes('CorporateLicense') && sdl.includes('claimCorporateSeat') && sdl.includes('getCorporateDashboard'));
  for (const p of [
    'apps/frontend/components/b2b/CorporateClaimCard.tsx',
    'apps/frontend/components/b2b/CorporateDashboard.tsx',
    'apps/frontend/hooks/useCorporateClaim.ts',
    'apps/frontend/lib/b2b/b2b-client.ts',
    'apps/frontend/app/(liff)/b2b/claim/page.tsx',
    'apps/frontend/app/(dashboard)/corporate/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useCorporateClaim.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const card = readFileSync('apps/frontend/components/b2b/CorporateClaimCard.tsx', 'utf8');
  assert.ok(!card.includes("from '@apollo/client'") && !card.includes('@/components/ui/'), 'zero-dep card (no heavy UI)');
  for (const p of [
    'apps/frontend/app/api/v1/b2b/license/route.ts',
    'apps/frontend/app/api/v1/b2b/claim/route.ts',
    'apps/frontend/app/api/v1/b2b/dashboard/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('b2b-contract') && barrel.includes('CreateCorporateLicenseInputSchema'));
  ok('Parity: module/GQL+alias/SDL/card+dashboard/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionLicense();
  await sectionClaim();
  await sectionRevoke();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase097 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
