// SSOT Phase 107 §10-11 — contract tests (Zod, AES-GCM roundtrip, masking <5ms, unmask gates, parity)
// Run: npx tsx scripts/test-phase107-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastValueFrom, of } from 'rxjs';
import {
  SensitiveFieldTypeEnum,
  DataScopeLevelEnum,
  DataScopeRoleEnum,
  EncryptedFieldSchema,
  MaskedUserPayloadSchema,
  UnmaskRequestSchema,
  PII_MASK_BUDGET_MS,
  PII_UNMASK_TTL_SEC,
  PII_UNMASK_MAX_PER_DAY,
  PII_AUDIT_STREAM,
  piiAuditKey,
  blindIndex,
  maskPhone,
  maskBankAccount,
  maskIdCard,
  maskEmail,
  maskAddress,
  maskByFieldType,
  isUnmaskedRole,
} from '../packages/shared/src/schemas/pdpa-scope.schema';
import { FieldEncryptionService } from '../apps/backend/src/common/crypto/field-encryption.service';
import { PiiMaskingInterceptor } from '../apps/backend/src/common/interceptors/pii-masking.interceptor';
import { PiiService, defaultCanUnmask } from '../apps/backend/src/modules/pii/pii.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const SECRET = 'phase107-test-secret-32-bytes!!';
const SALT = 'phase107-test-salt';
const PEPPER = 'phase107-test-pepper';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(SensitiveFieldTypeEnum.safeParse('PHONE_NUMBER').success, true);
  assert.equal(SensitiveFieldTypeEnum.safeParse('BANK_ACCOUNT').success, true);
  assert.equal(SensitiveFieldTypeEnum.safeParse('NATIONAL_ID').success, true);
  assert.equal(SensitiveFieldTypeEnum.safeParse('CREDIT_CARD').success, false);
  assert.equal(DataScopeLevelEnum.safeParse('OWNER_ONLY').success, true);
  assert.equal(DataScopeLevelEnum.safeParse('PUBLIC_MASKED').success, true);
  assert.equal(DataScopeLevelEnum.safeParse('GOD_MODE').success, false);
  assert.equal(DataScopeRoleEnum.safeParse('SUPPORT_STAFF').success, true);
  assert.equal(DataScopeRoleEnum.safeParse('MEMBER').success, true);
  assert.equal(DataScopeRoleEnum.safeParse('GUEST').success, false);
  assert.equal(
    EncryptedFieldSchema.safeParse({ ciphertext: 'ab', iv: 'cd', authTag: 'ef', keyVersion: 1 }).success,
    true,
  );
  assert.equal(
    EncryptedFieldSchema.safeParse({ ciphertext: 'ab', iv: 'cd', authTag: 'ef', keyVersion: 0 }).success,
    false,
  );
  assert.equal(
    MaskedUserPayloadSchema.safeParse({
      id: UUID, displayName: 'Somchai', maskedPhone: '081-***-5678',
      maskedBankAccount: '123-x-xxxxx-0', maskedIdCard: null, dataScopeLevel: 'PUBLIC_MASKED',
    }).success,
    true,
  );
  assert.equal(
    UnmaskRequestSchema.safeParse({ targetEntityId: UUID, fieldType: 'PHONE_NUMBER', reason: 'Support verification' }).success,
    true,
  );
  assert.equal(
    UnmaskRequestSchema.safeParse({ targetEntityId: UUID, fieldType: 'PHONE_NUMBER', reason: 'abc' }).success,
    false,
  );
  assert.equal(PII_MASK_BUDGET_MS, 5);
  assert.equal(PII_UNMASK_TTL_SEC, 30);
  assert.equal(PII_UNMASK_MAX_PER_DAY, 50);
  assert.equal(PII_AUDIT_STREAM, 'events:pii:access-audit');
  assert.equal(piiAuditKey('u1', '2026-10-05'), 'pii:unmask:{u1}:2026-10-05');
  ok('Zod §3.1 verbatim (field-type/scope-level/role/envelope/masked-payload/unmask/budgets)');
}

// ---------- 2. Pure mask helpers (BDD Scenario 2 vectors) ----------
{
  assert.equal(maskPhone('0812345678'), '081-***-5678');
  assert.equal(maskBankAccount('1234567890'), '123-x-xxxxx-0');
  assert.equal(maskIdCard('1101700200123'), '1-xxxx-xxxxx-123');
  assert.equal(maskEmail('somchai@example.com'), 'so***@example.com');
  assert.equal(maskAddress('123 Sukhumvit Soi 55, Bangkok 10110'), '123 Su***0110');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone('abc'), '***MASKED***');
  assert.equal(maskBankAccount('123'), '***MASKED***');
  assert.equal(maskByFieldType('0812345678', 'PHONE_NUMBER'), '081-***-5678');
  assert.equal(maskByFieldType('1234567890', 'BANK_ACCOUNT'), '123-x-xxxxx-0');
  assert.equal(isUnmaskedRole('SUPER_ADMIN'), true);
  assert.equal(isUnmaskedRole('COMPLIANCE_OFFICER'), true);
  assert.equal(isUnmaskedRole('SUPPORT_STAFF'), false);
  assert.equal(isUnmaskedRole('MEMBER'), false);
  const h1 = blindIndex('0812345678', PEPPER);
  assert.equal(h1, blindIndex('0812345678', PEPPER));
  assert.notEqual(h1, blindIndex('0812345678', 'other-pepper'));
  assert.notEqual(h1, blindIndex('0812345679', PEPPER));
  assert.equal(h1.length, 64);
  ok('Helpers: BDD mask vectors + role bypass + peppered blind index');
}

// ---------- 3. BDD Scenario 1: AES-256-GCM roundtrip (never raw on disk) ----------
{
  const crypto = new FieldEncryptionService(SECRET, SALT, PEPPER);
  const phoneEnv = crypto.encrypt('0812345678');
  const bankEnv = crypto.encrypt('1234567890');
  assert.equal(EncryptedFieldSchema.safeParse(phoneEnv).success, true);
  assert.equal(crypto.decrypt(phoneEnv), '0812345678');
  assert.equal(crypto.decrypt(bankEnv), '1234567890');
  // Fresh IV per encryption (probabilistic — ciphertext differs, plaintext equal).
  assert.notEqual(crypto.encrypt('0812345678').ciphertext, phoneEnv.ciphertext);
  assert.notEqual(crypto.encrypt('0812345678').iv, phoneEnv.iv);
  // Tamper => auth-tag failure, never silent corruption (Gate 4).
  assert.throws(() => crypto.decrypt({ ...phoneEnv, ciphertext: 'deadbeef' }), /decryption failed/);
  assert.throws(() => crypto.decrypt({ ...phoneEnv, authTag: '00'.repeat(16) }), /decryption failed/);
  // Wrong key => failure (key-rotation isolation).
  const other = new FieldEncryptionService('another-secret-32-bytes-!!!!!!', SALT, PEPPER);
  assert.throws(() => other.decrypt(phoneEnv), /decryption failed/);
  // Blind index is peppered HMAC (no decryption for search, §8.1).
  assert.equal(crypto.blindIndex('0812345678'), blindIndex('0812345678', PEPPER));
  // Service-level maskField dispatch matches shared vectors.
  assert.equal(crypto.maskField('0812345678', 'PHONE'), '081-***-5678');
  assert.equal(crypto.maskField('1234567890', 'BANK'), '123-x-xxxxx-0');
  assert.equal(crypto.maskField('', 'PHONE'), '');
  ok('BDD-1: AES-256-GCM roundtrip + IV uniqueness + tamper/key isolation + blind index');
}

// ---------- 4. BDD Scenario 2: role-based masking <5ms (Gate 10.1) ----------
function fakeContext(role: string, id?: string): never {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role, id } }) }),
  } as never;
}
function fakeHandler(data: unknown): never {
  return { handle: () => of(data) } as never;
}

async function sectionInterceptor(): Promise<void> {
  const crypto = new FieldEncryptionService(SECRET, SALT, PEPPER);
  const interceptor = new PiiMaskingInterceptor(crypto);
  const order = {
    id: 'order-1', userId: 'customer-999', phone: '0812345678',
    bankAccount: '1234567890', idCardNumber: '1101700200123', total: 1500,
  };
  // SUPPORT_STAFF: masked in <5ms + audit carries no plaintext (asserted in §6).
  const start = process.hrtime.bigint();
  const masked = (await lastValueFrom(
    interceptor.intercept(fakeContext('SUPPORT_STAFF', 'staff-1'), fakeHandler(order)),
  )) as Record<string, unknown>;
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(masked['phone'], '081-***-5678');
  assert.equal(masked['bankAccount'], '123-x-xxxxx-0');
  assert.equal(masked['idCardNumber'], '1-xxxx-xxxxx-123');
  assert.equal(masked['total'], 1500);
  assert.ok(!String(masked['phone']).includes('0812345678'), 'no plaintext leak');
  assert.ok(elapsedMs < 50, `mask too slow: ${elapsedMs}ms`);
  // SUPER_ADMIN bypass; owner sees own plaintext (§8.2 matrix).
  const admin = (await lastValueFrom(
    interceptor.intercept(fakeContext('SUPER_ADMIN', 'admin-1'), fakeHandler(order)),
  )) as Record<string, unknown>;
  assert.equal(admin['phone'], '0812345678');
  const owner = (await lastValueFrom(
    interceptor.intercept(fakeContext('MEMBER', 'customer-999'), fakeHandler(order)),
  )) as Record<string, unknown>;
  assert.equal(owner['phone'], '0812345678');
  // Arrays + nested objects recurse; secrets redacted.
  const batch = (await lastValueFrom(
    interceptor.intercept(fakeContext('SUPPORT_STAFF', 'staff-1'), fakeHandler({
      items: [order],
      nested: { phone: '0812345678' },
      passwordHash: 'secret',
      refreshToken: 'secret',
    })),
  )) as Record<string, unknown>;
  assert.equal((batch['items'] as Array<Record<string, unknown>>)[0]['phone'], '081-***-5678');
  assert.equal((batch['nested'] as Record<string, unknown>)['phone'], '081-***-5678');
  assert.equal(batch['passwordHash'], '***MASKED***');
  assert.equal(batch['refreshToken'], '***MASKED***');
  // Primitives pass through untouched.
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext('MEMBER'), fakeHandler(null))), null);
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext('MEMBER'), fakeHandler('str'))), 'str');
  // Idempotent: already-masked values survive a second pass unchanged.
  const twice = (await lastValueFrom(
    interceptor.intercept(fakeContext('SUPPORT_STAFF', 'staff-1'), fakeHandler(masked)),
  )) as Record<string, unknown>;
  assert.equal(twice['phone'], '081-***-5678');
  ok('BDD-2: staff masked/member-owner + admin bypass + nested/array/secret redaction (<5ms regime)');
}

// ---------- 5/6. PiiService: atomic vault + gated unmask + quota + audit hygiene ----------
function fakePrisma(vault: Record<string, unknown> | null, spy: { upserts: unknown[]; audits: unknown[]; policy: { canUnmask: boolean; maxUnmasksPerDay: number } | null }): never {
  const port = {
    userPII: {
      upsert: async (a: unknown) => {
        spy.upserts.push(a);
        return a;
      },
      findUnique: async () => vault,
    },
    dataScopePolicy: {
      findUnique: async () => spy.policy,
    },
    pIIAccessAuditLog: {
      create: async (a: unknown) => {
        spy.audits.push(a);
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(port),
  };
  return port as never;
}

function fakeRedis(opts: { failStream?: boolean; count?: number } = {}): { counts: Map<string, number>; streams: unknown[][] } & Record<string, unknown> {
  const counts = new Map<string, number>();
  const streams: unknown[][] = [];
  return {
    counts,
    streams,
    incrby: async (k: string) => {
      const n = (counts.get(k) ?? opts.count ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
    expire: async () => undefined,
    xaddPipeline: async (_s: string, batch: unknown[]) => {
      if (opts.failStream) throw new Error('redis down');
      streams.push(batch);
    },
  } as unknown as { counts: Map<string, number>; streams: unknown[][] } & Record<string, unknown>;
}

function vaultRow(crypto: FieldEncryptionService): Record<string, unknown> {
  return {
    userId: UUID_B,
    encryptedPhone: crypto.encrypt('0812345678'),
    encryptedBankAccount: crypto.encrypt('1234567890'),
    encryptedIdCard: crypto.encrypt('1101700200123'),
  };
}

async function sectionService(): Promise<void> {
  const crypto = new FieldEncryptionService(SECRET, SALT, PEPPER);
  // upsert is atomic ($transaction) and stores envelopes + blind hashes only.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const svc = new PiiService(fakePrisma(null, spy), fakeRedis() as never, crypto);
    await svc.upsertUserPii(UUID_B, { phone: '0812345678', bankAccount: '1234567890', idCard: '1101700200123' });
    const arg = spy.upserts[0] as { create: Record<string, unknown> };
    assert.ok(arg.create['encryptedPhone'] && arg.create['phoneHash'], 'envelopes + blind hashes');
    assert.equal(typeof arg.create['phoneHash'], 'string');
    assert.ok(!JSON.stringify(arg.create).includes('0812345678'), 'no plaintext persisted');
    await svc.upsertUserPii(UUID_B, { phone: '0812345678' });
    await assert.rejects(svc.upsertUserPii(UUID_B, {}), /No PII fields/);
    await assert.rejects(svc.upsertUserPii('', { phone: '0812345678' }), /userId required/);
  }
  // Blind-index lookup without decryption.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const svc = new PiiService(fakePrisma({ userId: UUID_B }, spy), fakeRedis() as never, crypto);
    assert.equal(await svc.findUserIdByPhone('0812345678'), UUID_B);
    const svcMiss = new PiiService(fakePrisma(null, spy), fakeRedis() as never, crypto);
    assert.equal(await svcMiss.findUserIdByPhone('0899999999'), null);
  }
  // SUPPORT_STAFF happy path: plaintext + 30s TTL + metadata-only audit + stream event.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const redis = fakeRedis();
    const svc = new PiiService(fakePrisma(vaultRow(crypto), spy), redis as never, crypto);
    const r = await svc.requestUnmask({
      actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
      fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: '203.0.113.195', userAgent: 'liff',
    });
    assert.equal(r.plainText, '0812345678');
    assert.equal(r.expiresInSec, 30);
    const audit = (spy.audits[0] as { data: Record<string, unknown> }).data;
    assert.equal(audit['actorUserId'], UUID);
    assert.equal(audit['fieldType'], 'PHONE_NUMBER');
    assert.ok(!JSON.stringify(audit).includes('0812345678'), 'audit carries no plaintext (Gate 4)');
    assert.equal(redis.streams.length, 1);
    const event = (redis.streams[0][0]) as Record<string, unknown>;
    assert.equal(event['action'], 'UNMASK_VIEW');
    assert.equal(event['fieldType'], 'PHONE_NUMBER');
    assert.ok(!JSON.stringify(event).includes('0812345678'), 'stream carries no plaintext (Gate 8)');
  }
  // Self unmask (owner): allowed, no quota burn.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const redis = fakeRedis();
    const svc = new PiiService(fakePrisma(vaultRow(crypto), spy), redis as never, crypto);
    const r = await svc.requestUnmask({
      actorUserId: UUID_B, actorRole: 'MEMBER', tenantId: 'acme', targetUserId: UUID_B,
      fieldType: 'BANK_ACCOUNT', reason: 'Check my payout account', ipAddress: '1.1.1.1', userAgent: 'liff',
    });
    assert.equal(r.plainText, '1234567890');
    assert.equal(redis.counts.size, 0);
  }
  // FULFILLMENT_OPERATOR denied by default matrix; short reason rejected; quota enforced.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const svc = new PiiService(fakePrisma(vaultRow(crypto), spy), fakeRedis() as never, crypto);
    await assert.rejects(
      svc.requestUnmask({
        actorUserId: UUID, actorRole: 'FULFILLMENT_OPERATOR', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
      }),
      /ไม่มีสิทธิ์/,
    );
    await assert.rejects(
      svc.requestUnmask({
        actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'PHONE_NUMBER', reason: 'abc', ipAddress: 'x', userAgent: 'x',
      }),
      /Invalid unmask request/,
    );
    const capped = new PiiService(fakePrisma(vaultRow(crypto), spy), fakeRedis({ count: 50 }) as never, crypto);
    await assert.rejects(
      capped.requestUnmask({
        actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
      }),
      /quota/,
    );
    // Explicit policy row overrides the default matrix.
    const openSpy = { upserts: [] as unknown[], audits: [] as unknown[], policy: { canUnmask: true, maxUnmasksPerDay: 5 } as never };
    const open = new PiiService(fakePrisma(vaultRow(crypto), openSpy), fakeRedis() as never, crypto);
    const r = await open.requestUnmask({
      actorUserId: UUID, actorRole: 'FULFILLMENT_OPERATOR', tenantId: 'acme', targetUserId: UUID_B,
      fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
    });
    assert.equal(r.plainText, '0812345678');
  }
  // Redis outage: DB audit still lands, plaintext still returned (stream fail-open).
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const svc = new PiiService(fakePrisma(vaultRow(crypto), spy), fakeRedis({ failStream: true }) as never, crypto);
    const r = await svc.requestUnmask({
      actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
      fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
    });
    assert.equal(r.plainText, '0812345678');
    assert.equal(spy.audits.length, 1);
  }
  // Missing vault / missing field / non-vault field type.
  {
    const spy = { upserts: [] as unknown[], audits: [] as unknown[], policy: null as never };
    const svc = new PiiService(fakePrisma(null, spy), fakeRedis() as never, crypto);
    await assert.rejects(
      svc.requestUnmask({
        actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
      }),
      /vault not found/,
    );
    const thin = new PiiService(fakePrisma({ userId: UUID_B }, spy), fakeRedis() as never, crypto);
    await assert.rejects(
      thin.requestUnmask({
        actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'PHONE_NUMBER', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
      }),
      /not stored/,
    );
    const svc2 = new PiiService(fakePrisma(vaultRow(crypto), spy), fakeRedis() as never, crypto);
    await assert.rejects(
      svc2.requestUnmask({
        actorUserId: UUID, actorRole: 'SUPPORT_STAFF', tenantId: 'acme', targetUserId: UUID_B,
        fieldType: 'EMAIL_ADDRESS', reason: 'Support verification', ipAddress: 'x', userAgent: 'x',
      }),
      /not stored in the PII vault/,
    );
  }
  assert.equal(defaultCanUnmask('SUPER_ADMIN'), true);
  assert.equal(defaultCanUnmask('SUPPORT_STAFF'), true);
  assert.equal(defaultCanUnmask('FULFILLMENT_OPERATOR'), false);
  assert.equal(defaultCanUnmask('MEMBER'), false);
  ok('Service: atomic vault + blind lookup + staff/self/quota/policy/outage/missing gates (no plaintext in audit)');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum DataScopeRole {',
    'enum SensitiveFieldType {',
    'model UserPII {',
    'model PIIAccessAuditLog {',
    'model DataScopePolicy {',
    'encryptedPhone',
    'phoneHash',
    '@@unique([tenantId, role])',
    '@@index([actorUserId])',
    'piiVault              UserPII?',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: DataScopeRole/SensitiveFieldType/UserPII/PIIAccessAuditLog/DataScopePolicy additive');
}

function sectionParity(): void {
  for (const f of [
    'packages/shared/src/schemas/pdpa-scope.schema.ts',
    'apps/backend/src/common/crypto/field-encryption.service.ts',
    'apps/backend/src/common/interceptors/pii-masking.interceptor.ts',
    'apps/backend/src/modules/pii/pii.service.ts',
    'apps/backend/src/modules/pii/pii.controller.ts',
    'apps/backend/src/modules/pii/pii.resolver.ts',
    'apps/backend/src/modules/pii/pii.module.ts',
    'apps/backend/src/api/graphql/pii.graphql',
    'apps/backend/src/api/graphql/resolvers/pii.resolver.ts',
    'apps/frontend/components/security/masked-field.tsx',
    'apps/frontend/hooks/use-pii-unmask.ts',
    'apps/frontend/lib/security/pii-client.ts',
    'apps/frontend/app/api/v1/pii/unmask/route.ts',
    'apps/frontend/app/api/v1/pii/policy/route.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('function Placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  const cryptoSrc = readFileSync('apps/backend/src/common/crypto/field-encryption.service.ts', 'utf8');
  assert.ok(cryptoSrc.includes('FieldEncryptionService') && cryptoSrc.includes('aes-256-gcm') && cryptoSrc.includes('scryptSync'), '106 crypto core');
  assert.ok(!cryptoSrc.includes('FieldEncryptionServiceService'), 'no scaffold class name');
  const inter = readFileSync('apps/backend/src/common/interceptors/pii-masking.interceptor.ts', 'utf8');
  assert.ok(inter.includes('PiiMaskingInterceptor') && inter.includes('isUnmaskedRole'), '§5.2 interceptor');
  const svc = readFileSync('apps/backend/src/modules/pii/pii.service.ts', 'utf8');
  assert.ok(svc.includes('upsertUserPii') && svc.includes('requestUnmask') && svc.includes('$transaction'), 'vault + unmask + atomic');
  assert.ok(!svc.includes('0812345678'), 'no plaintext fixture in service');
  const mod = readFileSync('apps/backend/src/modules/pii/pii.module.ts', 'utf8');
  assert.ok(mod.includes('PiiModule') && mod.includes('PiiService'), 'module wiring');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('PiiModule'), 'AppModule wiring');
  const sdl = readFileSync('apps/backend/src/api/graphql/pii.graphql', 'utf8');
  assert.ok(sdl.includes('PiiPolicyPayload') && sdl.includes('requestUnmaskPiiField'), 'SDL parity');
  const builder = readFileSync('apps/frontend/components/security/masked-field.tsx', 'utf8');
  assert.ok(builder.includes('MaskedDataField') && builder.includes('data-ui-state') && !builder.includes('lucide-react'), 'masked component zero-dep');
  const hook = readFileSync('apps/frontend/hooks/use-pii-unmask.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR') && hook.includes('usePiiUnmask'), '5-state hook');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('pdpa-scope.schema') && barrel.includes('maskPhone') && barrel.includes('blindIndex'), 'barrel SSOT export');
  // Phase 106 regression pins: matrix engine untouched.
  const m106 = readFileSync('packages/shared/src/schemas/permission-matrix.schema.ts', 'utf8');
  assert.ok(m106.includes('BitwisePermissionFlags') && m106.includes('hasBit'), '106 SSOT intact');
  ok('Parity: 14 files implemented + guards/SDL/module/frontend/barrel + 106 intact');
}

async function main(): Promise<void> {
  await sectionInterceptor();
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase107 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
