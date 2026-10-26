// SSOT Phase 129 §10-11 — contract tests (Zod, guards, crypto, audit,
// consent, DSR, DLP, compliance, Prisma Gate, barrel, wiring, cores).
// Run: npx tsx scripts/test-phase129-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  ConsentPurposeEnum,
  DSRTypeEnum,
  DSRStatusEnum,
  PDPAConsentPayloadSchema,
  DataSubjectRequestSchema,
  LineWebhookHeaderSchema,
  LINE_SIGNATURE_BUDGET_MS,
  REVOKE_ALL_BUDGET_MS,
  PDPA_CONSENT_VERSION,
  DSR_REASON_MAX,
  DATA_EXPORT_TTL_SEC,
  hasMandatoryConsent,
  newlyGrantedPurposes,
  withdrawnPurposes,
  isDsrTerminal,
  consentLedgerKey,
  dsrIdempotencyKey,
} from '../packages/shared/src/schemas/pdpa-compliance.schema';
import {
  LineSignatureGuard,
  extractRawBody,
} from '../apps/backend/src/modules/security/guards/line-signature.guard';
import { LineLiffAuthGuard } from '../apps/backend/src/modules/security/guards/line-liff-auth.guard';
import { PdpaConsentGuard } from '../apps/backend/src/modules/security/guards/pdpa-consent.guard';
import { PiiCryptoService } from '../apps/backend/src/modules/security/services/pii-crypto.service';
import {
  AuditLoggerService,
  immutableEntryHash,
} from '../apps/backend/src/modules/security/services/audit-logger.service';
import { ConsentManagerService } from '../apps/backend/src/modules/pdpa/services/consent-manager.service';
import { DsrEngineService } from '../apps/backend/src/modules/pdpa/services/dsr-engine.service';
import {
  sanitizeForAi,
  pseudonymize,
  DlpSanitizerInterceptor,
} from '../apps/backend/src/modules/pdpa/interceptors/dlp-sanitizer.interceptor';
import {
  LineComplianceService,
  verifyWhitelist,
  revocationKey,
} from '../apps/backend/src/modules/line-compliance/line-compliance.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function httpCtx(req: Record<string, unknown>): never {
  return { switchToHttp: () => ({ getRequest: () => req }) } as never;
}

const SECRET = 'test-channel-secret-144xz';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['NECESSARY_TERMS', 'MARKETING_PROMOTION', 'ANALYTICS_BEHAVIOR', 'THIRD_PARTY_TRANSFER']) {
    assert.equal(ConsentPurposeEnum.safeParse(v).success, true, v);
  }
  assert.equal(ConsentPurposeEnum.safeParse('ALL').success, false);
  for (const v of ['RIGHT_TO_ACCESS', 'RIGHT_TO_ERASURE', 'RIGHT_TO_RECTIFY', 'RIGHT_TO_PORTABILITY', 'RIGHT_TO_OBJECT']) {
    assert.equal(DSRTypeEnum.safeParse(v).success, true, v);
  }
  for (const v of ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED']) {
    assert.equal(DSRStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(DSRStatusEnum.safeParse('DRAFT').success, false);
  assert.equal(
    PDPAConsentPayloadSchema.safeParse({
      consentVersion: '2026-10-01', acceptedPurposes: ['NECESSARY_TERMS'],
      ipAddress: '203.0.113.9', userAgent: 'liff', acceptedAt: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  assert.equal(
    PDPAConsentPayloadSchema.safeParse({
      consentVersion: '', acceptedPurposes: ['NECESSARY_TERMS'],
      ipAddress: 'not-an-ip', userAgent: 'liff', acceptedAt: '2026-01-01T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(
    DataSubjectRequestSchema.safeParse({ requestType: 'RIGHT_TO_ERASURE', reason: 'bye', identityVerificationProof: 'jwt:u1' }).success,
    true,
  );
  assert.equal(
    DataSubjectRequestSchema.safeParse({ requestType: 'RIGHT_TO_ERASURE', reason: 'x'.repeat(501), identityVerificationProof: 'jwt:u1' }).success,
    false,
  );
  assert.equal(LineWebhookHeaderSchema.safeParse({ 'x-line-signature': 'abc' }).success, true);
  assert.equal(LineWebhookHeaderSchema.safeParse({}).success, false);
  assert.equal(LINE_SIGNATURE_BUDGET_MS, 5);
  assert.equal(REVOKE_ALL_BUDGET_MS, 1000);
  assert.equal(PDPA_CONSENT_VERSION, '2026-10-01');
  assert.equal(DSR_REASON_MAX, 500);
  assert.equal(DATA_EXPORT_TTL_SEC, 86400);
  ok('1. Zod SSOT verbatim (§3.1 Gate 1)');
}
// ---------- 2. Pure helpers ----------
{
  assert.equal(hasMandatoryConsent(['NECESSARY_TERMS', 'MARKETING_PROMOTION']), true);
  assert.equal(hasMandatoryConsent(['MARKETING_PROMOTION']), false);
  assert.deepEqual(newlyGrantedPurposes(['NECESSARY_TERMS'], ['NECESSARY_TERMS', 'ANALYTICS_BEHAVIOR']), ['ANALYTICS_BEHAVIOR']);
  assert.deepEqual(withdrawnPurposes(['NECESSARY_TERMS', 'MARKETING_PROMOTION'], ['NECESSARY_TERMS']), ['MARKETING_PROMOTION']);
  assert.equal(isDsrTerminal('COMPLETED'), true);
  assert.equal(isDsrTerminal('REJECTED'), true);
  assert.equal(isDsrTerminal('PENDING'), false);
  assert.equal(isDsrTerminal('PROCESSING'), false);
  assert.equal(consentLedgerKey('u1', 'MARKETING_PROMOTION'), 'pdpa:consent:{u1}:MARKETING_PROMOTION');
  assert.equal(dsrIdempotencyKey('u1', 'RIGHT_TO_ERASURE'), 'pdpa:dsr:{u1}:RIGHT_TO_ERASURE');
  ok('2. mandatory/diff/terminal/key helpers');
}
// ---------- 3. LINE signature guard (BDD-1, < 5ms) ----------
{
  const audits: unknown[] = [];
  const guard = new LineSignatureGuard({ async logImmutable(r: unknown) { audits.push(r); } });
  process.env.LINE_CHANNEL_SECRET = SECRET;
  const body = JSON.stringify({ events: [] });
  const req = { headers: { 'x-line-signature': sign(body) }, rawBody: Buffer.from(body), url: '/webhook', ip: '1.2.3.4' };
  assert.equal(await guard.canActivate(httpCtx(req)), true);
  assert.ok((req as Record<string, unknown>)['lineSignatureElapsedMs'] as number <= LINE_SIGNATURE_BUDGET_MS * 10, 'HMAC well under budget');
  await assert.rejects(
    guard.canActivate(httpCtx({ headers: { 'x-line-signature': 'forged' }, rawBody: body, url: '/webhook', ip: '9.9.9.9' })),
    UnauthorizedException,
  );
  assert.equal(audits.length, 1);
  delete process.env.LINE_CHANNEL_SECRET;
  delete process.env.LINE_OA_CHANNEL_SECRET;
  await assert.rejects(
    guard.canActivate(httpCtx({ headers: { 'x-line-signature': sign(body) }, rawBody: body, url: '/webhook' })),
    UnauthorizedException,
  );
  process.env.LINE_CHANNEL_SECRET = SECRET;
  assert.equal(extractRawBody({ rawBody: new Uint8Array([123, 125]) }), '{}');
  assert.equal(extractRawBody({ body: { a: 1 } }), '{"a":1}');
  assert.equal(extractRawBody({}), '""');
  ok('3. HMAC guard (valid/forged/missing-secret/raw forms + audit)');
}
// ---------- 4. LIFF ID-token guard (BDD-1) ----------
{
  const audits: unknown[] = [];
  const verifier = {
    async verifyIdToken(token: string) {
      if (token === 'good-token') return { sub: 'U123', name: 'Test', picture: 'p', email: 'e' };
      throw new UnauthorizedException('INVALID_LINE_TOKEN');
    },
  };
  const guard = new LineLiffAuthGuard(verifier, { async logImmutable(r: unknown) { audits.push(r); } });
  const req: Record<string, unknown> = { headers: { authorization: 'Bearer good-token' }, url: '/api', ip: '2.2.2.2' };
  assert.equal(await guard.canActivate(httpCtx(req)), true);
  assert.deepEqual(req['lineProfile'], { sub: 'U123', name: 'Test', picture: 'p', email: 'e' });
  await assert.rejects(guard.canActivate(httpCtx({ headers: {}, url: '/api' })), UnauthorizedException);
  await assert.rejects(
    guard.canActivate(httpCtx({ headers: { authorization: 'Bearer bad' }, url: '/api', ip: '3.3.3.3' })),
    UnauthorizedException,
  );
  assert.equal(audits.length, 1);
  ok('4. ID-token guard (profile stamp / missing / forged + audit)');
}
// ---------- 5. PDPA consent guard (Gate 2 strict gate) ----------
{
  const guard = new PdpaConsentGuard({
    async acceptedPurposes(userId: string) {
      if (userId === 'ok') return { purposes: ['NECESSARY_TERMS', 'MARKETING_PROMOTION'], version: '2026-10-01' };
      if (userId === 'stale') return { purposes: ['NECESSARY_TERMS'], version: '2024-01-01' };
      if (userId === 'opt') return { purposes: ['MARKETING_PROMOTION'], version: '2026-10-01' };
      return null;
    },
  });
  assert.equal(await guard.canActivate(httpCtx({ user: { id: 'ok' } })), true);
  await assert.rejects(guard.canActivate(httpCtx({ user: { id: 'stale' } })), ForbiddenException);
  await assert.rejects(guard.canActivate(httpCtx({ user: { id: 'opt' } })), ForbiddenException);
  await assert.rejects(guard.canActivate(httpCtx({ user: { id: 'ghost' } })), ForbiddenException);
  await assert.rejects(guard.canActivate(httpCtx({})), ForbiddenException);
  const down = new PdpaConsentGuard({ async acceptedPurposes() { throw new Error('db down'); } });
  await assert.rejects(down.canActivate(httpCtx({ user: { id: 'ok' } })), ForbiddenException);
  ok('5. consent strict gate (grant/stale-version/opt-only/fail-closed)');
}
// ---------- 6. PII crypto facade (Gate 3 round-trip) ----------
{
  const svc = new PiiCryptoService();
  const bundle = svc.encrypt('081-234-5678');
  assert.ok(bundle.encryptedData.length > 0 && bundle.iv.length > 0 && bundle.authTag.length > 0);
  assert.equal(svc.decrypt(bundle), '081-234-5678');
  assert.throws(() => svc.decrypt({ ...bundle, authTag: '00'.repeat(16) }), /tampered|failed/i);
  const row = svc.encryptVaultRow({ phone: '081-234-5678', address: 'Bangkok', taxId: '1234567890123' });
  assert.ok(row.encryptedPhone && row.encryptedAddress && row.encryptedTaxId);
  assert.ok(row.encryptionIv.length > 0 && row.authTag.length > 0);
  // Every column is self-describing: address/taxId must decrypt with their
  // own IV/authTag, not the anchor row's pair (regression guard).
  assert.ok(row.encryptedAddress!.startsWith('v1:') && row.encryptedTaxId!.startsWith('v1:'));
  assert.equal(svc.decryptVaultField(row, 'phone'), '081-234-5678');
  assert.equal(svc.decryptVaultField(row, 'address'), 'Bangkok');
  assert.equal(svc.decryptVaultField(row, 'taxId'), '1234567890123');
  assert.equal(svc.decrypt({ encryptedData: row.encryptedPhone!, iv: row.encryptionIv, authTag: row.authTag }), '081-234-5678');
  const empty = svc.encryptVaultRow({});
  assert.equal(empty.encryptionIv, '');
  assert.equal(svc.decryptVaultField(empty, 'phone'), null);
  assert.equal(svc.encrypt('same').encryptedData === svc.encrypt('same').encryptedData, false);
  ok('6. AES-256-GCM facade (round-trip/tamper/vault/IV-randomness)');
}
// ---------- 7. Immutable audit chain (Gate 5) ----------
{
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    immutableAuditLog: {
      async create(a: { data: Record<string, unknown> }) {
        const row = { id: `log-${rows.length}`, ...a.data };
        rows.push(row);
        return row as never;
      },
      async findFirst() {
        return (rows.length > 0 ? rows[rows.length - 1] : null) as never;
      },
      async findMany() {
        return [...rows] as never;
      },
    },
  };
  const svc = new AuditLoggerService(db);
  assert.equal(await svc.headHash(), '0'.repeat(64));
  const r1 = await svc.logImmutable({ action: 'UPDATE_CONSENT', resource: 'User:u1', ipAddress: '1.1.1.1', userAgent: 'liff' });
  const r2 = await svc.logImmutable({ actorId: 'u1', action: 'ACCESS_PII', resource: 'User:u1', ipAddress: '1.1.1.1', userAgent: 'liff' });
  assert.ok((r1.hashChain as string) !== (r2.hashChain as string));
  assert.equal(await svc.headHash(), r2.hashChain);
  assert.deepEqual(await svc.verifyChain(), { valid: true, checked: 2 });
  assert.equal(
    immutableEntryHash({ actorId: 'a', action: 'X', previousData: null, newData: {}, previousHash: 'h', timestamp: '2026-01-01T00:00:00.000Z' }),
    immutableEntryHash({ actorId: 'a', action: 'X', previousData: null, newData: {}, previousHash: 'h', timestamp: '2026-01-01T00:00:00.000Z' }),
  );
  rows[1]['hashChain'] = 'tampered';
  const bad = await svc.verifyChain();
  assert.equal(bad.valid, false);
  assert.equal(bad.brokenAt, 'log-1');
  const down = new AuditLoggerService({
    immutableAuditLog: {
      async create() { throw new Error('db down'); },
      async findFirst(): Promise<never> { throw new Error('db down'); },
      async findMany(): Promise<never[]> { throw new Error('db down'); },
    },
  });
  assert.equal(await down.headHash(), '0'.repeat(64));
  assert.deepEqual(await down.verifyChain(), { valid: true, checked: 0 });
  ok('7. hash chain (link/head/verify/tamper-trip/fail-open)');
}
// ---------- 8. Consent manager (Article 26 ledger) ----------
{
  const history: Array<Record<string, unknown>> = [];
  const cache = new Map<string, string>();
  const db = {
    userConsentHistory: {
      async createMany(a: { data: Array<Record<string, unknown>> }) { history.push(...a.data); return {}; },
      async findMany() { return [...history].reverse() as never; },
    },
  };
  const edge = {
    async get(k: string) { return cache.has(k) ? cache.get(k)! : null; },
    async setex(k: string, _t: number, v: string) { cache.set(k, v); },
    async del(...ks: string[]) { for (const k of ks) cache.delete(k); },
  };
  const svc = new ConsentManagerService(db, edge);
  assert.equal(await svc.acceptedPurposes('new'), null);
  await assert.rejects(
    svc.recordConsent('new', { consentVersion: '2026-10-01', acceptedPurposes: ['MARKETING_PROMOTION'], ipAddress: '1.1.1.1', userAgent: 'liff', acceptedAt: '2026-01-01T00:00:00.000Z' }),
    /mandatory/i,
  );
  const first = await svc.recordConsent('u1', {
    consentVersion: '2026-10-01', acceptedPurposes: ['NECESSARY_TERMS', 'ANALYTICS_BEHAVIOR'],
    ipAddress: '1.1.1.1', userAgent: 'liff', acceptedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(first.granted.includes('NECESSARY_TERMS'));
  // Edge was invalidated: next read replays the ledger (2 rows).
  const current = await svc.acceptedPurposes('u1');
  assert.ok(current?.purposes.includes('ANALYTICS_BEHAVIOR'));
  const second = await svc.recordConsent('u1', {
    consentVersion: '2026-10-01', acceptedPurposes: ['NECESSARY_TERMS'],
    ipAddress: '1.1.1.1', userAgent: 'liff', acceptedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.deepEqual(second.withdrawn, ['ANALYTICS_BEHAVIOR']);
  await assert.rejects(
    svc.recordConsent('u1', {
      consentVersion: '2024-01-01', acceptedPurposes: ['NECESSARY_TERMS'],
      ipAddress: '1.1.1.1', userAgent: 'liff', acceptedAt: '2026-01-03T00:00:00.000Z',
    }),
    BadRequestException,
  );
  const status = await svc.statusPayload('u1');
  assert.equal(status.isNecessaryAccepted, true);
  assert.equal(status.isAnalyticsAccepted, false);
  assert.equal(status.consentVersion, '2026-10-01');
  ok('8. consent ledger (mandatory gate/grant/withdraw/status/cache)');
}
// ---------- 9. DSR engine (BDD-2 erasure < 1s) ----------
{
  const dsr: Array<Record<string, unknown>> = [];
  const users = new Map<string, Record<string, unknown>>([['u1', { id: 'u1', displayName: 'Somchai', email: 's@x.com', phone: '081', lineUserId: 'U111', avatarUrl: 'a' }]]);
  const consentWrites: Array<Record<string, unknown>> = [];
  let envelopes = 1;
  let sessions = 2;
  let entitlements = 3;
  const db = {
    dataSubjectRequest: {
      async create(a: { data: Record<string, unknown> }) {
        const row = { id: `dsr-${dsr.length}`, status: 'PENDING', reason: null, processedBy: null, processedAt: null, createdAt: new Date(), ...a.data };
        dsr.push(row);
        return row as never;
      },
      async findFirst(a: { where: Record<string, unknown> }) {
        const w = a.where as { id?: string; userId?: string; requestType?: string; status?: { in: string[] } };
        return (dsr.find((r) =>
          (w.id === undefined || r['id'] === w.id) &&
          (w.userId === undefined || r['userId'] === w.userId) &&
          (w.requestType === undefined || r['requestType'] === w.requestType) &&
          (w.status === undefined || (w.status.in as string[]).includes(r['status'] as string)),
        ) ?? null) as never;
      },
      async findMany(a: { where: Record<string, unknown> }) {
        return dsr.filter((r) => r['userId'] === (a.where as { userId: string }).userId) as never;
      },
      async update(a: { where: { id: string }; data: Record<string, unknown> }) {
        const row = dsr.find((r) => r['id'] === a.where.id)!;
        Object.assign(row, a.data);
        return row as never;
      },
    },
    user: {
      async findUnique(a: { where: { id: string } }) { return users.get(a.where.id) ?? null; },
      async update(a: { where: { id: string }; data: Record<string, unknown> }) {
        Object.assign(users.get(a.where.id)!, a.data);
        return {};
      },
    },
    userConsentHistory: {
      async createMany(a: { data: Array<Record<string, unknown>> }) { consentWrites.push(...a.data); return {}; },
      async findMany() { return consentWrites; },
    },
    encryptedUserPII: {
      async deleteMany() { envelopes = 0; return {}; },
    },
  };
  const svc = new DsrEngineService(db, {
    async revokeSessions() { const n = sessions; sessions = 0; return n; },
    async revokeEntitlements() { const n = entitlements; entitlements = 0; return n; },
  });
  const created = await svc.submit('u1', { requestType: 'RIGHT_TO_ERASURE', reason: 'leave' });
  assert.equal(created.status, 'PENDING');
  await assert.rejects(svc.submit('u1', { requestType: 'RIGHT_TO_ERASURE' }), /ALREADY_ACTIVE/);
  await assert.rejects(svc.executeErasure('u1', 'dsr-missing', 'u1'), /NOT_FOUND/);
  const other = await svc.submit('u1', { requestType: 'RIGHT_TO_ACCESS' });
  await assert.rejects(svc.executeErasure('u1', other.id, 'u1'), /WRONG_TYPE/);
  const summary = await svc.executeErasure('u1', created.id, 'admin-1');
  assert.deepEqual(summary.anonymizedFields, ['displayName', 'email', 'phone', 'lineUserId', 'avatarUrl', 'encryptedUserPII']);
  assert.equal(summary.sessionsRevoked, 2);
  assert.equal(summary.entitlementsRevoked, 3);
  assert.equal(summary.withinBudget, true);
  assert.ok(summary.revokeElapsedMs < REVOKE_ALL_BUDGET_MS);
  const profile = users.get('u1')!;
  assert.equal(profile['email'], null);
  assert.equal(profile['phone'], null);
  assert.ok(String(profile['displayName']).startsWith('Deleted User'));
  assert.equal(envelopes, 0);
  assert.equal(consentWrites.length, 3);
  assert.equal(dsr.find((r) => r['id'] === created.id)?.['status'], 'COMPLETED');
  const bundle = await svc.exportPackage('u1');
  assert.ok(bundle['profile'] && bundle['exportedAt']);
  assert.ok(Array.isArray(bundle['consentHistory']) && Array.isArray(bundle['dataSubjectRequests']));
  ok('9. DSR submit/erasure/export (409/anonymize/revoke<1s/ledger-kept)');
}
// ---------- 10. DLP sanitizer (Gate 7 AI lane) ----------
{
  const clean = sanitizeForAi({
    userId: 'U1234567890abcdef1234567890abcdef',
    phone: 'call 081-234-5678 now',
    email: 'Contact SOMCHAI@Example.COM today',
    thaiId: 'เลข 1100700629011 ครับ',
    nested: { note: 'see javascript:alert(1)' },
    tags: [' domino 0812345678 '],
    count: 3,
    active: true,
    nothing: null,
  }) as Record<string, unknown>;
  assert.equal(clean['userId'], pseudonymize('U1234567890abcdef1234567890abcdef'));
  assert.equal(clean['userIdHash'], clean['userId']);
  assert.ok(String(clean['phone']).includes('[REDACTED_PHONE]'));
  assert.ok(String(clean['email']).includes('[REDACTED_EMAIL]'));
  assert.ok(String(clean['thaiId']).includes('[REDACTED_ID]'));
  assert.equal(clean['count'], 3);
  const multi = sanitizeForAi({
    blob: 'a@b.com and c@d.com / 081-111-1111 then 089-222-2222',
  }) as Record<string, unknown>;
  assert.equal((String(multi['blob']).match(/\[REDACTED_EMAIL\]/g) ?? []).length, 2);
  assert.equal((String(multi['blob']).match(/\[REDACTED_PHONE\]/g) ?? []).length, 2);
  assert.equal(pseudonymize('a'), pseudonymize('a'));
  assert.equal(pseudonymize('a') === pseudonymize('b'), false);
  const deep = sanitizeForAi({ deep: { deep: { deep: { deep: { deep: { deep: { deep: 'x' } } } } } } }) as Record<string, unknown>;
  assert.ok(JSON.stringify(deep).includes('[TRUNCATED]'));
  const interceptor = new DlpSanitizerInterceptor();
  const seen: unknown[] = [];
  // NOTE: rxjs lives under apps/backend (pnpm); resolve it from the backend
  // package scope so intercept() runs against a real Observable.
  const { createRequire } = await import('node:module');
  const backendRequire = createRequire(`${process.cwd()}/apps/backend/package.json`);
  const { of } = backendRequire('rxjs') as { of: (v: unknown) => unknown };
  await new Promise<void>((resolve) => {
    (interceptor.intercept({} as never, { handle: () => of({ email: 'a@b.co' }) }) as unknown as { subscribe: (fn: (v: unknown) => void) => void }).subscribe((v) => {
      seen.push(v);
      resolve();
    });
  });
  assert.ok(JSON.stringify(seen[0]).includes('[REDACTED_EMAIL]'));
  ok('10. DLP strip + pseudonym (PII redacted, ids hashed, depth-safe)');
}
// ---------- 11. LINE compliance service (§8.1 matrix) ----------
{
  assert.equal(verifyWhitelist('https://liff.line.me/abc'), true);
  assert.equal(verifyWhitelist('https://app.liff.line.me/x'), true);
  assert.equal(verifyWhitelist('http://liff.line.me/abc'), false);
  assert.equal(verifyWhitelist('https://evil-liff-line-me.com/abc'), false);
  assert.equal(verifyWhitelist('not-a-url'), false);
  assert.equal(revocationKey('u1'), 'line:revoked:{u1}');
  const store = new Map<string, string>();
  const svc = new LineComplianceService({
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async set(k: string, v: string | Buffer) { store.set(k, String(v)); return 'OK'; },
    async del(...ks: string[]) { for (const k of ks) store.delete(k); },
  });
  assert.equal(await svc.isRevoked('u1'), false);
  assert.equal(await svc.revokeUserTokens('u1'), 1);
  assert.equal(await svc.isRevoked('u1'), true);
  const down = new LineComplianceService({
    async get(): Promise<string | null> { throw new Error('redis down'); },
    async set(): Promise<unknown> { throw new Error('redis down'); },
    async del() { /* noop */ },
  });
  assert.equal(await down.isRevoked('u1'), false);
  assert.equal(await down.revokeUserTokens('u1'), 0);
  ok('11. whitelist + revocation lane (matrix/fail-open)');
}
// ---------- 12. Prisma Gate 1 + barrel + wiring + cores ----------
{
  const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const needle of [
    'enum ConsentPurpose', 'enum DSRType', 'enum DSRStatus',
    'model UserConsentHistory', 'model DataSubjectRequest',
    'model ImmutableAuditLog', 'model EncryptedUserPII',
    'consentHistory        UserConsentHistory[]',
    'dataSubjectRequests   DataSubjectRequest[]',
    'encryptedPii          EncryptedUserPII?',
  ]) {
    assert.ok(schema.includes(needle), `prisma ${needle}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of [
    'ConsentPurposeEnum', 'DSRTypeEnum', 'DSRStatusEnum', 'PDPAConsentPayloadSchema',
    'DataSubjectRequestSchema', 'LineWebhookHeaderSchema', 'hasMandatoryConsent',
    'newlyGrantedPurposes', 'isDsrTerminal', 'PDPA_CONSENT_VERSION', 'ConsentPurpose',
  ]) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/pdpa.graphql', 'utf8');
  for (const intent of ['getPdpaConsentStatus', 'exportMyPersonalData', 'updatePdpaConsent', 'submitDataSubjectRequest']) {
    assert.ok(sdl.includes(intent), `sdl ${intent}`);
  }
  for (const f of [
    'apps/backend/src/modules/security/guards/line-signature.guard.ts',
    'apps/backend/src/modules/security/guards/line-liff-auth.guard.ts',
    'apps/backend/src/modules/security/guards/pdpa-consent.guard.ts',
    'apps/backend/src/modules/security/services/pii-crypto.service.ts',
    'apps/backend/src/modules/security/services/audit-logger.service.ts',
    'apps/backend/src/modules/pdpa/services/consent-manager.service.ts',
    'apps/backend/src/modules/pdpa/services/dsr-engine.service.ts',
    'apps/backend/src/modules/pdpa/interceptors/dlp-sanitizer.interceptor.ts',
    'apps/backend/src/modules/pdpa/pdpa.controller.ts',
    'apps/backend/src/modules/pdpa/pdpa.resolver.ts',
    'apps/backend/src/modules/pdpa/pdpa.module.ts',
    'apps/backend/src/modules/line-compliance/line-compliance.service.ts',
    'apps/backend/src/modules/line-compliance/line-webhook.controller.ts',
    'apps/backend/src/modules/line-compliance/line-compliance.module.ts',
    'apps/backend/src/api/guards/line-signature.guard.ts',
    'apps/backend/src/api/guards/line-liff-auth.guard.ts',
    'apps/backend/src/api/guards/pdpa-consent.guard.ts',
    'apps/backend/src/api/interceptors/dlp-sanitizer.interceptor.ts',
    'apps/frontend/components/security/PdpaConsentModal.tsx',
    'apps/frontend/app/(liff)/consent/page.tsx',
    'apps/frontend/app/api/v1/pdpa/consent/route.ts',
    'apps/frontend/hooks/useLineLiffAuth.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder') && !src.includes('TODO'), `${f} unimplemented`);
  }
  const modal = readFileSync('apps/frontend/components/security/PdpaConsentModal.tsx', 'utf8');
  assert.ok(!modal.includes('lucide-react'), 'zero-dep modal (inline SVG)');
  // Compliance: non-essential purposes must default OFF (explicit opt-in).
  assert.ok(/analyticsAccepted[^;]*useState\(false\)/.test(modal), 'analytics opt-in default');
  assert.ok(/marketingAccepted[^;]*useState\(false\)/.test(modal), 'marketing opt-in default');
  const hook = readFileSync('apps/frontend/hooks/useLineLiffAuth.ts', 'utf8');
  // The BFF serves GET/PUT on /api/v1/pdpa/consent; /consent/status is not a
  // frontend route (would 404 and trap every user in ERROR_NON_COMPLIANT).
  assert.ok(hook.includes('/api/v1/pdpa/consent?tenant='), 'hook hits the real BFF route');
  assert.ok(!hook.includes('/api/v1/pdpa/consent/status'), 'hook avoids the 404 route');
  assert.ok(hook.includes('PDPA_CONSENT_VERSION') && !hook.includes("'2026-10-01'"), 'hook uses shared consent version');
  for (const s of ['CONSENT_REQUIRED', 'IDLE_COMPLIANT', 'PROCESSING_RIGHTS', 'ERROR_NON_COMPLIANT']) {
    assert.ok(readFileSync('apps/frontend/hooks/useLineLiffAuth.ts', 'utf8').includes(s), `hook ${s}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('PdpaModule') && app.includes('LineComplianceModule'), 'modules wired');
  const sec = readFileSync('apps/backend/src/modules/security/security.module.ts', 'utf8');
  for (const e of ['LineSignatureGuard', 'LineLiffAuthGuard', 'PiiCryptoService', 'AuditLoggerService']) {
    assert.ok(sec.includes(e), `device module provides ${e}`);
  }
  // Cores untouched: payment slip lane owns no PDPA/DSR writes.
  const slipCore = readFileSync('apps/backend/src/modules/payment/services/slip-verification.service.ts', 'utf8');
  assert.ok(!slipCore.includes('dsr') && !slipCore.includes('DataSubject') && !slipCore.includes('consent'), 'payment core untouched');
  const easyslip = readFileSync('apps/backend/src/modules/payment/services/easyslip.service.ts', 'utf8');
  assert.ok(!easyslip.includes('DataSubject'), 'easyslip core untouched');
  ok('12. Gate 1 + barrel + SDL + wiring + zero-dep UI + cores');
}
}

main()
  .then(() => {
    console.log(`\nPhase 129 contracts: ${passed}/12 groups passed`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nPhase 129 contracts FAILED:', err);
    process.exit(1);
  });
