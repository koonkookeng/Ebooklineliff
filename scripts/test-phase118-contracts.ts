// SSOT Phase 118 §10-11 — contract tests (Zod, chain crypto, append +
// verify, interceptor/guard, cron alerts, WORM sink, stress, Prisma Gate 1,
// SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase118-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AuditAdminRoleEnum,
  AuditActionCategoryEnum,
  AuditIntegrityStatusEnum,
  AuditLogEntrySchema,
  AuditIntegrityCheckResultSchema,
  AUDIT_APPEND_BUDGET_MS,
  AUDIT_WORM_BATCH_SIZE,
  AUDIT_WORM_RETENTION_DAYS,
  AUDIT_CRON_INTERVAL_MS,
  AUDIT_EVENT_STREAM,
  AUDIT_GENESIS_HASH,
  auditBlockHash,
  signAuditHash,
  verifyAuditSignature,
  auditVaultKey,
  auditQueueKey,
} from '../packages/shared/src/schemas/audit-log.schema';
import {
  assertAppendable,
  assertActor,
  assertAuditableRole,
  assertAuditViewer,
} from '../apps/backend/src/modules/audit-log/domain/audit-log.entity';
import { calculateBlockHash, verifyWindow } from '../apps/backend/src/modules/audit-log/domain/hash-chain.engine';
import { CryptoSignerEngine, resolveAuditSecret } from '../apps/backend/src/modules/audit-log/domain/crypto-signer.engine';
import { AuditLogService } from '../apps/backend/src/modules/audit-log/application/audit-log.service';
import { AuditInterceptor, Audit, AUDIT_METADATA_KEY } from '../apps/backend/src/modules/audit-log/application/audit-interceptor';
import { IntegrityCheckerCron } from '../apps/backend/src/modules/audit-log/application/integrity-checker.cron';
import { AuditLogRepository } from '../apps/backend/src/modules/audit-log/infrastructure/audit-log.repository';
import { R2WormVaultAdapter } from '../apps/backend/src/modules/audit-log/infrastructure/r2-worm-vault.adapter';
import { R2WormVaultService, AUDIT_WORM_PREFIX } from '../apps/backend/src/infra/cloudflare/r2-worm-vault.service';
import { AuditContextGuard } from '../apps/backend/src/modules/auth/guards/audit-context.guard';
import { buildAuditFlex, auditFlexByteSize, AUDIT_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/audit-log/application/audit-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const SECRET = 'phase118-test-secret-32bytes!!!!';
const ACTOR = { id: 'a1', role: 'FINANCE_ADMIN', email: 'fin@acme.co', ipAddress: '10.0.0.1', userAgent: 'phase118-test' };
const TS = '2026-10-10T00:00:00.000Z';

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR', 'SELLER']) {
    assert.equal(AuditAdminRoleEnum.safeParse(v).success, true, v);
  }
  assert.equal(AuditAdminRoleEnum.safeParse('MEMBER').success, false);
  for (const v of ['AUTHENTICATION', 'USER_MANAGEMENT', 'FINANCIAL_TRANSACTION', 'CONTENT_MUTATION', 'SYSTEM_CONFIGURATION', 'ENTITLEMENT_GRANT']) {
    assert.equal(AuditActionCategoryEnum.safeParse(v).success, true, v);
  }
  assert.equal(AuditActionCategoryEnum.safeParse('BILLING').success, false);
  for (const v of ['VERIFIED_VALID', 'PENDING_VAULT_SYNC', 'TAMPER_DETECTED', 'CORRUPTED_CHAIN']) {
    assert.equal(AuditIntegrityStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    AuditLogEntrySchema.safeParse({
      id: 'x', sequenceNumber: 1, actorId: 'a1', actorRole: 'FINANCE_ADMIN', actorEmail: 'f@x.co',
      ipAddress: '10.0.0.1', userAgent: 'ua', actionCategory: 'FINANCIAL_TRANSACTION', actionName: 'REFUND_ORDER',
      targetEntity: 'Order', previousHash: '0'.repeat(64), currentHash: 'a'.repeat(64), signature: 'sig', createdAt: TS,
    }).success,
    true,
  );
  assert.equal(
    AuditLogEntrySchema.safeParse({
      id: 'x', sequenceNumber: 0, actorId: 'a1', actorRole: 'FINANCE_ADMIN', actorEmail: 'not-an-email',
      ipAddress: '10.0.0.1', userAgent: 'ua', actionCategory: 'FINANCIAL_TRANSACTION', actionName: 'X',
      targetEntity: 'Order', previousHash: 'short', currentHash: 'a'.repeat(64), signature: 'sig', createdAt: TS,
    }).success,
    false,
  );
  assert.equal(
    AuditIntegrityCheckResultSchema.safeParse({
      totalBlocksChecked: 3, isValid: false, tamperedBlockSequences: [2], checkedAt: TS, vaultSyncStatus: 'OUT_OF_SYNC',
    }).success,
    true,
  );
  ok('1. Zod SSOT verbatim (roles/categories/integrity/entry/result)');
}

// ---------- 2. Block hash + HMAC + vault layout + budgets ----------
{
  const h = auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: 'REFUND_ORDER', payloadBefore: null, payloadAfter: { amount: 100 }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: 'REFUND_ORDER', payloadBefore: null, payloadAfter: { amount: 100 }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS }), h);
  assert.notEqual(auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: 'REFUND_ORDER', payloadBefore: null, payloadAfter: { amount: 101 }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS }), h);
  // engine parity (single formula, Zero Redundant).
  assert.equal(calculateBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: 'REFUND_ORDER', payloadBefore: null, payloadAfter: { amount: 100 }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS }), h);
  const sig = signAuditHash(h, SECRET);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(verifyAuditSignature(h, sig, SECRET), true);
  assert.equal(verifyAuditSignature(h, `${sig.slice(0, -1)}0`, SECRET), false);
  assert.equal(verifyAuditSignature(h, sig, 'wrong-secret'), false);
  assert.equal(verifyAuditSignature(h, 'short', SECRET), false);
  assert.equal(resolveAuditSecret('explicit'), 'explicit');
  assert.ok(resolveAuditSecret('').length >= 32, 'dev fallback non-empty');
  assert.equal(auditVaultKey(1000, '2026-10-10T00:00:00.000Z'), 'audit-worm/2026/10/1000.ndjson');
  assert.equal(auditVaultKey(7n, '2026-01-02T00:00:00.000Z'), 'audit-worm/2026/01/7.ndjson');
  assert.equal(AUDIT_APPEND_BUDGET_MS, 2);
  assert.equal(AUDIT_WORM_BATCH_SIZE, 1000);
  assert.equal(AUDIT_WORM_RETENTION_DAYS, 2555);
  assert.equal(AUDIT_CRON_INTERVAL_MS, 86400000);
  assert.equal(AUDIT_EVENT_STREAM, 'stream:audit:events');
  assert.equal(AUDIT_GENESIS_HASH, '0'.repeat(64));
  assert.equal(auditQueueKey('TAMPER_DETECTED', 1), 'audit:queue:TAMPER_DETECTED:1');
  assert.equal(AUDIT_FLEX_BUDGET_BYTES, 10_000);
  ok('2. SHA-256 formula/HMAC/timing-safe/vault layout + budgets');
}

// ---------- 3. Entity guards (roles/viewer/actor/append-only) ----------
{
  assertAuditableRole('SELLER');
  assert.throws(() => assertAuditableRole('MEMBER'), /admin role/);
  assert.throws(() => assertAuditableRole(undefined), /admin role/);
  assertAuditViewer('SUPER_ADMIN');
  assertAuditViewer('FINANCE_ADMIN');
  assert.throws(() => assertAuditViewer('SELLER'), /auditor/);
  assert.throws(() => assertAuditViewer(undefined), /auditor/);
  assertActor(ACTOR);
  assert.throws(() => assertActor({ ...ACTOR, id: '' }), /Missing audit actor/);
  assert.throws(() => assertActor({ ...ACTOR, email: 'nope' }), /Invalid audit actor email/);
  assertAppendable('CREATE');
  assert.throws(() => assertAppendable('UPDATE'), /append-only/);
  assert.throws(() => assertAppendable('DELETE'), /append-only/);
  ok('3. Role/viewer/actor/append-only guards');
}

// ---------- 4. Chain engine (parity + window verify + break) ----------
{
  const b1 = { sequenceNumber: 1, actorId: 'a1', actionName: 'A', payloadBefore: null, payloadAfter: { x: 1 }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS, currentHash: '' };
  const h1 = calculateBlockHash({ ...b1 });
  const b2 = { sequenceNumber: 2, actorId: 'a1', actionName: 'B', payloadBefore: { x: 1 }, payloadAfter: { x: 2 }, previousHash: h1, timestamp: TS, currentHash: '' };
  const h2 = calculateBlockHash({ ...b2 });
  const rows = [{ ...b1, currentHash: h1 }, { ...b2, currentHash: h2 }];
  assert.deepEqual(verifyWindow(rows), { valid: true, checked: 2 });
  assert.deepEqual(verifyWindow([...rows].reverse()), { valid: true, checked: 2 });
  assert.deepEqual(verifyWindow([]), { valid: true, checked: 0 });
  const cut = [{ ...rows[0]! }, { ...rows[1]!, previousHash: 'f'.repeat(64) }];
  assert.deepEqual(verifyWindow(cut), { valid: false, checked: 0, brokenAt: 2 });
  const forged = [{ ...rows[0]! }, { ...rows[1]!, currentHash: 'e'.repeat(64) }];
  assert.deepEqual(verifyWindow(forged), { valid: false, checked: 0, brokenAt: 2 });
  ok('4. Chain parity + order-free verify + link/payload breaks');
}

// ---------- 5. Append service (dual-lane mirror + link + SLA + guards) ----------
{
  const events: unknown[][] = [];
  const created: unknown[] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const repo = {
    latest: async () => null,
    list: async () => [],
    window: async () => [],
    count: async () => 0,
    syncState: async () => null,
    recordSyncState: async () => ({}),
    append: async (data: unknown) => {
      created.push(data);
      return { id: 'row-1', sequenceNumber: 1 };
    },
  };
  const signer = new CryptoSignerEngine(SECRET);
  const svc = new AuditLogService(redis as never, repo as never, signer);
  const out = await svc.append(ACTOR, {
    actionCategory: 'FINANCIAL_TRANSACTION', actionName: 'REFUND_ORDER', targetEntity: 'Order',
    targetEntityId: 'o1', payloadAfter: { amount: 100 },
  });
  assert.equal(out.sequenceNumber, 1);
  assert.match(out.currentHash, /^[0-9a-f]{64}$/);
  const row = created[0] as Record<string, unknown>;
  // 109 lane mirror intact.
  assert.deepEqual([row['userId'], row['action'], row['ipAddress']], ['a1', 'FINANCIAL_TRANSACTION:REFUND_ORDER', '10.0.0.1']);
  assert.deepEqual((row['details'] as Record<string, unknown>)['amount'], 100);
  // 118 lane linked + signed.
  assert.equal(row['previousHash'], AUDIT_GENESIS_HASH);
  assert.equal(row['actorRole'], 'FINANCE_ADMIN');
  assert.equal(signer.verify(row['currentHash'] as string, row['signature'] as string), true);
  assert.ok(events.some((e) => JSON.stringify(e).includes('audit.appended')), 'appended stream');
  // chained second block links to the first.
  const repo2 = {
    ...repo,
    latest: async () => ({ currentHash: out.currentHash }),
    append: async (data: unknown) => {
      created.push(data);
      return { id: 'row-2', sequenceNumber: 2 };
    },
  };
  const svc2 = new AuditLogService(redis as never, repo2 as never, signer);
  const out2 = await svc2.append(ACTOR, { actionCategory: 'USER_MANAGEMENT', actionName: 'FREEZE', targetEntity: 'User' });
  assert.equal((created[1] as Record<string, unknown>)['previousHash'], out.currentHash);
  assert.equal(out2.sequenceNumber, 2);
  // guards + pagination.
  await assert.rejects(() => svc.append({ ...ACTOR, role: 'MEMBER' }, { actionCategory: 'X', actionName: 'Y', targetEntity: 'Z' }), /admin role/);
  await assert.rejects(() => svc.append(ACTOR, { actionCategory: '', actionName: 'Y', targetEntity: 'Z' }), /Invalid audit/);
  const listed = await svc.list({ page: 0, limit: 500 });
  assert.deepEqual(listed, []);
  ok('5. Atomic append (dual-lane + link + sign + stream) + guards');
}

// ---------- 6. verifyChain end-to-end (valid/tampered/empty) ----------
{
  const signer = new CryptoSignerEngine(SECRET);
  function block(seq: number, prev: string, action: string, after: unknown, ts: string): Record<string, unknown> {
    return {
      sequenceNumber: seq, actorId: 'a1', actorRole: 'FINANCE_ADMIN', actorEmail: 'f@x.co',
      actionCategory: 'FINANCIAL_TRANSACTION', actionName: action, targetEntity: 'Order',
      payloadBeforeJson: null, payloadAfterJson: after, previousHash: prev,
      currentHash: auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: action, payloadBefore: null, payloadAfter: after, previousHash: prev, timestamp: ts }),
      integrityStatus: 'PENDING_VAULT_SYNC', createdAt: new Date(ts),
    };
  }
  const t1 = '2026-10-10T00:00:00.000Z';
  const t2 = '2026-10-10T01:00:00.000Z';
  const t3 = '2026-10-10T02:00:00.000Z';
  const r1 = block(1, AUDIT_GENESIS_HASH, 'A', { v: 1 }, t1);
  const r2 = block(2, r1['currentHash'] as string, 'B', { v: 2 }, t2);
  const r3 = block(3, r2['currentHash'] as string, 'C', { v: 3 }, t3);
  const svcFor = (rows: Record<string, unknown>[]) =>
    new AuditLogService(
      { xaddPipeline: async () => undefined } as never,
      { latest: async () => null, list: async () => [], window: async () => rows, count: async () => 0, syncState: async () => null, recordSyncState: async () => ({}) } as never,
      signer,
    );
  const good = await svcFor([r1, r2, r3]).verifyChain();
  assert.deepEqual([good.valid, good.checked, good.tamperedBlockSequences], [true, 3, []]);
  const cut = await svcFor([r1, { ...r2, previousHash: 'f'.repeat(64) }, r3]).verifyChain();
  assert.deepEqual([cut.valid, cut.brokenAt, cut.tamperedBlockSequences], [false, 2, [2]]);
  const forged = await svcFor([r1, r2, { ...r3, payloadAfterJson: { v: 999 } }]).verifyChain();
  assert.deepEqual([forged.valid, forged.brokenAt], [false, 3]);
  const empty = await svcFor([]).verifyChain();
  assert.deepEqual([empty.valid, empty.checked], [true, 0]);
  ok('6. verifyChain (3-link valid + cut + forgery + empty)');
}

// ---------- 7. Interceptor (@Audit metadata + fail-open) + guard ----------
{
  const appended: unknown[][] = [];
  const audit = {
    append: async (...a: unknown[]) => {
      appended.push(a);
      return { id: 'x', sequenceNumber: 1, currentHash: 'h' };
    },
    list: async () => [],
    verifyChain: async () => ({ valid: true, checked: 0, tamperedBlockSequences: [] }),
  };
  const interceptor = new AuditInterceptor(audit as never);

  class Demo {
    @Audit('FINANCIAL_TRANSACTION', 'REFUND_ORDER', 'Order')
    bill(): string {
      return 'ok';
    }

    plain(): string {
      return 'ok';
    }
  }
  const meta = Reflect.getMetadata(AUDIT_METADATA_KEY, Demo.prototype.bill);
  assert.deepEqual(meta, { category: 'FINANCIAL_TRANSACTION', action: 'REFUND_ORDER', entity: 'Order' });

  const req = { user: { id: 'a1', role: 'FINANCE_ADMIN', email: 'f@x.co' }, headers: {}, body: { amount: 5 }, ip: '10.0.0.9' };
  const ctxFor = (handler: () => unknown) =>
    ({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) }) as never;
  // Real rxjs `of` resolved from the backend workspace (the interceptor
  // returns genuine Observables; scripts run outside the app graph so the
  // import is path-anchored, not barrel-resolved).
  const { join } = await import('node:path');
  const rxRequire = eval('require') as (id: string) => { of: (v: unknown) => { subscribe: (a: unknown) => void } };
  const { of } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  const just = (v: unknown) => of(v);
  await new Promise<void>((resolve) => {
    interceptor.intercept(ctxFor(Demo.prototype.bill), { handle: () => just('ok') } as never).subscribe(() => resolve());
  });
  assert.equal(appended.length, 1);
  const [actorArg, inputArg] = appended[0] as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual([actorArg['id'], actorArg['ipAddress']], ['a1', '10.0.0.9']);
  assert.deepEqual([inputArg['actionName'], inputArg['targetEntity']], ['REFUND_ORDER', 'Order']);
  // unmarked handlers pass through untouched.
  await new Promise<void>((resolve) => {
    interceptor.intercept(ctxFor(Demo.prototype.plain), { handle: () => just('ok') } as never).subscribe(() => resolve());
  });
  assert.equal(appended.length, 1);
  // audit outage never breaks the mutation (fail-open).
  const downInterceptor = new AuditInterceptor({ append: async () => { throw new Error('db down'); } } as never);
  await new Promise<void>((resolve, reject) => {
    downInterceptor.intercept(ctxFor(Demo.prototype.bill), { handle: () => just('ok') } as never).subscribe({ next: () => resolve(), error: (e: unknown) => reject(e) });
  });

  const { AuditContextGuard } = await import('../apps/backend/src/modules/auth/guards/audit-context.guard');
  const guard = new AuditContextGuard();
  const gctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user, headers: {}, ip: '1.1.1.1' }) }) });
  assert.equal(guard.canActivate(gctx({ id: 'a1', role: 'SUPER_ADMIN', email: 's@x.co' }) as never), true);
  const stampedReq = { user: { id: 'a1', role: 'SUPER_ADMIN', email: 's@x.co' }, headers: {}, ip: '1.1.1.1' } as Record<string, unknown>;
  assert.equal(guard.canActivate({ switchToHttp: () => ({ getRequest: () => stampedReq }) } as never), true);
  assert.deepEqual((stampedReq['auditActor'] as Record<string, unknown>)['role'], 'SUPER_ADMIN');
  assert.throws(() => guard.canActivate(gctx(undefined) as never), /Missing authentication/);
  assert.throws(() => guard.canActivate(gctx({ id: 'a1', role: 'MEMBER' }) as never), /admin role/);
  // Gate 4: hash masking by role (resolver lane).
  const { AuditLogResolver: ALR } = await import('../apps/backend/src/modules/audit-log/presentation/audit-log.resolver');
  const listRows = [{
    id: 'r1', sequenceNumber: 9, actorId: 'a1', actorRole: 'FINANCE_ADMIN', actorEmail: 'f@x.co',
    actionCategory: 'FINANCIAL_TRANSACTION', actionName: 'REFUND_ORDER', targetEntity: 'Order',
    targetEntityId: null, previousHash: 'p'.repeat(64), currentHash: 'c'.repeat(64),
    integrityStatus: 'PENDING_VAULT_SYNC', createdAt: new Date(TS),
  }];
  const alr = new ALR({ list: async () => listRows } as never);
  const modCtx = { req: { user: { id: 'm1', role: 'CONTENT_MODERATOR' }, headers: {} } };
  const supCtx = { req: { user: { id: 's1', role: 'SUPER_ADMIN' }, headers: {} } };
  const masked = await alr.auditLogs(undefined, undefined, 1, 20, modCtx as never) as Array<{ currentHash: string }>;
  const revealed = await alr.auditLogs(undefined, undefined, 1, 20, supCtx as never) as Array<{ currentHash: string }>;
  assert.equal(masked[0]!.currentHash, '••••');
  assert.equal(revealed[0]!.currentHash, 'c'.repeat(64));
  ok('7. @Audit metadata + post-success append + fail-open + context guard + hash masking');
}

// ---------- 8. Cron: verified-quiet vs tamper-alert + lockdown streams ----------
{
  const streams: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { streams.push(a); } };
  const notified: unknown[][] = [];
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  const OLD_ENV = process.env['AUDIT_ALERT_LINE_USER_IDS'];
  process.env['AUDIT_ALERT_LINE_USER_IDS'] = 'U1,U2';
  try {
    const { IntegrityCheckerCron: Cron } = await import('../apps/backend/src/modules/audit-log/application/integrity-checker.cron');
    const validAudit = {
      verifyChain: async () => ({ valid: true, checked: 41, tamperedBlockSequences: [] }),
      list: async () => [],
      append: async () => ({}),
    };
    const quiet = await new Cron(validAudit as never, redis as never, notify as never).runOnce(5000, TENANT_X);
    assert.deepEqual([quiet.valid, quiet.checked, quiet.alerted], [true, 41, false]);
    assert.equal(notified.length, 0);
    assert.ok(streams.some((s) => JSON.stringify(s).includes('audit.integrity.verified')), 'verified stream');

    const brokenAudit = {
      verifyChain: async () => ({ valid: false, checked: 41, brokenAt: 7, tamperedBlockSequences: [7, 9] }),
      list: async () => [],
      append: async () => ({}),
    };
    const loud = await new Cron(brokenAudit as never, redis as never, notify as never).runOnce(5000, TENANT_X);
    assert.deepEqual([loud.valid, loud.alerted, loud.brokenAt], [false, true, 7]);
    assert.equal(notified.length, 2);
    assert.ok(streams.some((s) => JSON.stringify(s).includes('audit.tamper.detected')), 'tamper stream');
    assert.ok(streams.some((s) => JSON.stringify(s).includes('admin.lock.requested')), 'lockdown stream');
  } finally {
    if (OLD_ENV === undefined) delete process.env['AUDIT_ALERT_LINE_USER_IDS'];
    else process.env['AUDIT_ALERT_LINE_USER_IDS'] = OLD_ENV;
  }
  // Flex shapes (<10KB).
  const tamper = buildAuditFlex({ outcome: 'TAMPER_DETECTED', tenantName: TENANT_X, brokenAt: 7, checked: 41 });
  const clean = buildAuditFlex({ outcome: 'CHAIN_VERIFIED', tenantName: TENANT_X, checked: 41 });
  assert.ok(tamper.altText.includes('ปลอมแปลง') && clean.altText.includes('ผ่าน'));
  assert.ok(auditFlexByteSize(tamper) < AUDIT_FLEX_BUDGET_BYTES && auditFlexByteSize(clean) < AUDIT_FLEX_BUDGET_BYTES, 'flex < 10KB');
  ok('8. Cron quiet/alert lanes + lockdown + Flex budget');
}

// ---------- 9. WORM adapter + R2 service + sync state ----------
{
  const puts: Array<{ key: string; bytes: number; contentType: string }> = [];
  const r2 = {
    putObjectBuffer: async (key: string, body: Buffer, contentType: string) => {
      puts.push({ key, bytes: body.length, contentType });
      return { eTag: 'etag-1' };
    },
  };
  const { R2WormVaultAdapter: Adapter } = await import('../apps/backend/src/modules/audit-log/infrastructure/r2-worm-vault.adapter');
  const adapter = new Adapter(r2 as never);
  assert.equal(adapter.batchKey(1000, '2026-10-10T00:00:00.000Z'), 'audit-worm/2026/10/1000.ndjson');
  const blocks = [{ seq: 1 }, { seq: 2 }];
  assert.deepEqual(adapter.toNdjson(blocks).split('\n').length, 2);
  const sunk = await adapter.sinkBatch(blocks, 1000, '2026-10-10T00:00:00.000Z');
  assert.deepEqual([sunk?.r2ObjectKey, sunk?.blocks, sunk?.retentionDays, sunk?.eTag], ['audit-worm/2026/10/1000.ndjson', 2, 2555, 'etag-1']);
  assert.equal(puts[0]!.contentType, 'application/x-ndjson');
  assert.equal(await adapter.sinkBatch([], 1, TS), null);
  const downAdapter = new Adapter({ putObjectBuffer: async () => { throw new Error('r2 down'); } } as never);
  assert.equal(await downAdapter.sinkBatch(blocks, 1, TS), null);

  const worm = new R2WormVaultService(r2 as never);
  assert.equal(worm.prefix(), 'audit-worm/');
  assert.equal(worm.retentionDays(), 2555);
  await assert.rejects(() => worm.putBatch('other/1.ndjson', '{}'), /confined/);
  const okPut = await worm.putBatch('audit-worm/2026/10/1.ndjson', '{"a":1}');
  assert.equal(okPut.eTag, 'etag-1');

  const states: unknown[] = [];
  const repo = new AuditLogRepository({} as never);
  void repo;
  assert.ok(!('update' in repo) && !('delete' in repo) && !('updateMany' in repo), 'repository is create-only (append-only structural)');
  const repoSrc = readFileSync('apps/backend/src/modules/audit-log/infrastructure/audit-log.repository.ts', 'utf8');
  assert.ok(!repoSrc.includes('update(') && !repoSrc.includes('delete('), 'no update/delete surface in source');
  assert.ok(repoSrc.includes('recordSyncState'), 'sync-state writer present');
  void states;
  ok('9. WORM batch sink + prefix guard + create-only repository');
}

// ---------- 10. Stress: hash throughput + window verify (§10.1) ----------
{
  const N = 2000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: `ACT_${i % 7}`, payloadBefore: null, payloadAfter: { i }, previousHash: AUDIT_GENESIS_HASH, timestamp: TS });
  }
  const msPerBlock = (Date.now() - t0) / N;
  assert.ok(msPerBlock < AUDIT_APPEND_BUDGET_MS, `hash ${msPerBlock.toFixed(3)}ms/block < 2ms`);
  // 2000-link window verify timing.
  let prev = AUDIT_GENESIS_HASH;
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i <= N; i++) {
    const ch = auditBlockHash({ sequenceNumber: 0, actorId: 'a1', actionName: 'STRESS', payloadBefore: null, payloadAfter: { i }, previousHash: prev, timestamp: TS });
    rows.push({ sequenceNumber: i, actorId: 'a1', actionName: 'STRESS', payloadBeforeJson: null, payloadAfterJson: { i }, previousHash: prev, currentHash: ch, createdAt: new Date(TS) });
    prev = ch;
  }
  const signer = new CryptoSignerEngine(SECRET);
  const svc = new AuditLogService(
    { xaddPipeline: async () => undefined } as never,
    { latest: async () => null, list: async () => [], window: async () => rows, count: async () => 0, syncState: async () => null, recordSyncState: async () => ({}) } as never,
    signer,
  );
  const v0 = Date.now();
  const verdict = await svc.verifyChain(0, N);
  assert.deepEqual([verdict.valid, verdict.checked], [true, N]);
  console.log(`    stress: ${N} appends @${msPerBlock.toFixed(3)}ms/block, verify ${(Date.now() - v0)}ms total`);
  ok('10. 2000-block hash + verify equation + timing');
}

// ---------- 11. Prisma Gate 1 + trigger doc + SDL + module wiring ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR', 'SELLER']) {
    assert.ok(prisma.includes(v), `AuditAdminRole ${v}`);
  }
  for (const v of ['AUTHENTICATION', 'USER_MANAGEMENT', 'FINANCIAL_TRANSACTION', 'CONTENT_MUTATION', 'SYSTEM_CONFIGURATION', 'ENTITLEMENT_GRANT']) {
    assert.ok(prisma.includes(v), `AuditActionCategory ${v}`);
  }
  for (const m of ['enum AuditAdminRole', 'enum AuditActionCategory', 'enum AuditIntegrityStatus', 'model AuditVaultSyncState']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('sequenceNumber    BigInt'), 'hash-chain sequence column');
  assert.ok(prisma.includes('currentHash       String?'), '118 hash columns (nullable = 109 coexistence)');
  assert.ok(prisma.includes('auditActorLogs     AuditLog[]'), 'User actor back-relation');
  assert.ok(prisma.includes('@@index([currentHash])'), 'hash lookup index');
  const trigger = readFileSync('packages/db/prisma/audit-immutability.trigger.sql', 'utf8');
  assert.ok(trigger.includes('enforce_audit_log_immutability') && trigger.includes('RAISE EXCEPTION') && trigger.includes('ADVISORY'), 'trigger doc (DBA review, not auto-applied)');
  const sdl = readFileSync('apps/backend/src/api/graphql/audit/audit.graphql', 'utf8');
  for (const t of ['type AuditLogNode', 'type AuditVerifyResult', 'auditLogs', 'verifyAuditChain', 'appendAuditLog']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/audit-log.resolver.ts', 'utf8');
  assert.ok(alias.includes('AuditLogResolver') && !alias.includes('AuditLogResolverResolver'), 'api alias re-exports module resolver');
  const mod = readFileSync('apps/backend/src/modules/audit-log/audit-log.module.ts', 'utf8');
  for (const p of ['AuditLogService', 'AuditInterceptor', 'IntegrityCheckerCron', 'AuditLogRepository', 'HashChainEngine', 'CryptoSignerEngine', 'R2WormVaultAdapter', 'AuditLogResolver', 'AuditLogController', 'AuditNotificationService']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('AuditLogModule'), 'AppModule imports');
  const guard = readFileSync('apps/backend/src/modules/auth/guards/audit-context.guard.ts', 'utf8');
  assert.ok(guard.includes('AUDIT_ACTOR_KEY') && guard.includes('ForbiddenException'), 'context guard stamps actor, fail-closed');
  ok('11. Prisma Gate 1 + trigger doc + SDL + module/guard wiring');
}

// ---------- 12. Frontend Gate 3/4 (5 states, badges, gating, proxies) ----------
{
  const page = readFileSync('apps/frontend/app/(admin)/dashboard/audit-logs/page.tsx', 'utf8');
  for (const s of ['INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `console state ${s}`);
  }
  assert.ok(page.includes('verified-stamp') && page.includes('ลองใหม่'), 'stamp + retry');
  const viewer = readFileSync('apps/frontend/components/admin/audit-log-viewer.tsx', 'utf8');
  assert.ok(viewer.includes('chain-badge') && viewer.includes('tamper-banner') && viewer.includes('audit-row'), 'badge + banner + rows');
  assert.ok(viewer.includes('audit-prev') && viewer.includes('canSeeHashDetails'), 'auditor-gated detail');
  assert.ok(!viewer.includes("from 'lucide") && !viewer.includes('from "@tanstack') && !viewer.includes("from 'recharts"), 'no heavy UI imports');
  const lib = readFileSync('apps/frontend/lib/audit/audit-client.ts', 'utf8');
  assert.ok(lib.includes('canSeeHashDetails') && lib.includes('verify') && lib.includes('append'), 'client lanes + Gate 4 mirror');
  for (const p of [
    'apps/frontend/app/api/v1/admin/audit/logs/route.ts',
    'apps/frontend/app/api/v1/admin/audit/verify/route.ts',
    'apps/frontend/app/api/v1/admin/audit/append/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['AuditLogEntrySchema', 'AuditIntegrityCheckResultSchema', 'auditBlockHash', 'verifyAuditSignature', 'AUDIT_EVENT_STREAM', 'AUDIT_WORM_BATCH_SIZE']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + badges + hash gating + 3 proxies + barrel');
}
}

const TENANT_X = 'acme';

main()
  .then(() => console.log(`\nPhase 118 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 118 contracts FAILED:', err);
    process.exit(1);
  });
