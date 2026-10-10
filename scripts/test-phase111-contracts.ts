// SSOT Phase 111 §10-11 — contract tests (Zod, checksum/risk, AES-GCM,
// blind-index, masks, Flex budget, review atomicity, queue masking, webhook
// HMAC taxonomy, Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase111-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  KYCDocTypeEnum,
  KYCRiskLevelEnum,
  KycSubmissionInputSchema,
  KycReviewPayloadSchema,
  OcrExtractionResultSchema,
  KYC_QUEUE_PAGE_SIZE,
  KYC_DOC_VIEW_TTL_SEC,
  KYC_VERDICT_SLA_MS,
  kycQueueKey,
  kycRiskTier111,
} from '../packages/shared/src/schemas/kyc-queue.schema';
import { thaiIdChecksum } from '../packages/shared/src/schemas/kyc-contract';
import { KycEncryptionService } from '../apps/backend/src/modules/kyc/services/kyc-encryption.service';
import { PiiCryptoService, maskBankAccountNumber, maskIdCardNumber } from '../apps/backend/src/modules/kyc/services/pii-crypto.service';
import { blindIndexIdCard, KycRiskService } from '../apps/backend/src/modules/kyc/services/kyc-risk.service';
import { KycQueueReviewService } from '../apps/backend/src/modules/kyc/services/kyc-queue-review.service';
import { buildKycVerdictFlex, kycFlexByteSize, KYC_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/kyc/services/kyc-flex-message.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

// '1234567890121' is checksum-valid (352 % 11 === 0 -> check digit 1).
const VALID_ID = '1234567890121';
const KYC_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = '223e4567-e89b-12d3-a456-426614174001';
const ADMIN_ID = '323e4567-e89b-12d3-a456-426614174002';
const KEY = Buffer.alloc(32, 7);
const NET = { ipAddress: '127.0.0.1', userAgent: 'phase111-test', tenantName: 'acme' };

function validSubmission(): Record<string, unknown> {
  return {
    idCardNumber: VALID_ID,
    fullNameTh: 'สมชาย ใจดี',
    dateOfBirth: '2000-01-01T00:00:00.000Z',
    bankName: 'กสิกรไทย',
    bankAccountNumber: '1234567890',
    bankAccountName: 'สมชาย ใจดี',
    idCardImageBase64: 'data:image/webp;base64,AAA',
    bankBookImageBase64: 'data:image/webp;base64,BBB',
  };
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['THAI_NATIONAL_ID', 'PASSPORT', 'COMPANY_REGISTRATION', 'BANK_BOOK']) {
    assert.equal(KYCDocTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(KYCDocTypeEnum.safeParse('DRIVER_LICENSE').success, false);
  for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    assert.equal(KYCRiskLevelEnum.safeParse(v).success, true, v);
  }
  assert.equal(KycSubmissionInputSchema.safeParse(validSubmission()).success, true);
  assert.equal(KycSubmissionInputSchema.safeParse({ ...validSubmission(), idCardNumber: '123' }).success, false);
  assert.equal(KycSubmissionInputSchema.safeParse({ ...validSubmission(), idCardNumber: 'ABCDEFGHIJKLM' }).success, false);
  assert.equal(KycSubmissionInputSchema.safeParse({ ...validSubmission(), idCardImageBase64: '' }).success, false);
  assert.equal(
    KycReviewPayloadSchema.safeParse({ kycId: KYC_ID, status: 'VERIFIED', adminNotes: 'ok' }).success,
    true,
  );
  assert.equal(
    KycReviewPayloadSchema.safeParse({ kycId: KYC_ID, status: 'PENDING' }).success,
    false,
  );
  assert.equal(
    OcrExtractionResultSchema.safeParse({
      extractedIdNumber: VALID_ID, extractedNameTh: 'สมชาย', extractedBankAccount: '1234567890',
      confidenceScore: 97.5, isDocumentTampered: false, riskLevel: 'LOW',
    }).success,
    true,
  );
  assert.equal(
    OcrExtractionResultSchema.safeParse({
      extractedIdNumber: null, extractedNameTh: null, extractedBankAccount: null,
      confidenceScore: 101, isDocumentTampered: false, riskLevel: 'LOW',
    }).success,
    false,
  );
  ok('1. Zod SSOT verbatim (§3.1 submission/review/OCR)');
}

// ---------- 2. Checksum + 111 risk tiers (§7.1) ----------
{
  assert.equal(thaiIdChecksum(VALID_ID), true);
  assert.equal(thaiIdChecksum('1234567890122'), false);
  assert.equal(thaiIdChecksum('abc'), false);
  assert.equal(kycRiskTier111(97), 'LOW');
  assert.equal(kycRiskTier111(95), 'LOW');
  assert.equal(kycRiskTier111(94), 'MEDIUM');
  assert.equal(kycRiskTier111(80), 'MEDIUM');
  assert.equal(kycRiskTier111(79), 'HIGH');
  assert.equal(kycRiskTier111(99, { duplicateId: true }), 'CRITICAL');
  assert.equal(kycRiskTier111(99, { tampered: true }), 'HIGH');
  assert.equal(kycRiskTier111(99, { checksumValid: false }), 'HIGH');
  ok('2. Thai-ID checksum + §7.1 risk tiers (duplicate/tamper/checksum)');
}

// ---------- 3. AES-256-GCM round-trip + facade parity (§8.2) ----------
{
  const enc = new KycEncryptionService(KEY);
  const pii = new PiiCryptoService(enc);
  const ct1 = enc.encrypt(VALID_ID);
  const ct2 = enc.encrypt(VALID_ID);
  assert.notEqual(ct1, ct2); // random IV — ciphertexts differ
  assert.equal(enc.decrypt(ct1), VALID_ID);
  assert.equal(pii.decrypt(pii.encrypt('9012345678')), '9012345678');
  assert.throws(() => enc.decrypt('not-an-envelope'), /Malformed/);
  assert.throws(() => new KycEncryptionService(KEY).decrypt(enc.encrypt('x').slice(0, -2) + 'AA'), /./);
  const wrong = new KycEncryptionService(Buffer.alloc(32, 9));
  assert.throws(() => wrong.decrypt(ct1), /./);
  ok('3. AES-256-GCM round-trip, random-IV, facade parity, tamper fail');
}

// ---------- 4. Masks + blind index (§8.2) ----------
{
  assert.equal(maskIdCardNumber(VALID_ID), '1-2345-XXXXX-12-1');
  assert.equal(maskIdCardNumber('short'), 'X-XXXX-XXXXX-XX-X');
  assert.equal(maskBankAccountNumber('1234567890'), 'XXX-X-X6789-X');
  assert.equal(maskBankAccountNumber('12'), 'XXXX');
  const pii = new PiiCryptoService(new KycEncryptionService(KEY));
  assert.equal(pii.maskIdCard(VALID_ID), '1-2345-XXXXX-12-1');
  assert.equal(pii.maskBankAccount('1234567890'), 'XXX-X-X6789-X');
  const b1 = blindIndexIdCard(VALID_ID);
  assert.equal(b1, blindIndexIdCard(VALID_ID));
  assert.match(b1, /^[0-9a-f]{64}$/);
  assert.notEqual(b1, blindIndexIdCard('1234567890122'));
  ok('4. PDPA masks + SHA-256 blind index (deterministic/64-hex)');
}

// ---------- 5. Queue budgets + keys + Flex budget (Tasks 4/7) ----------
{
  assert.equal(KYC_QUEUE_PAGE_SIZE, 20);
  assert.equal(KYC_DOC_VIEW_TTL_SEC, 300);
  assert.equal(KYC_VERDICT_SLA_MS, 500);
  assert.equal(KYC_FLEX_BUDGET_BYTES, 10_000);
  assert.equal(kycQueueKey('PENDING', 1), 'kyc:queue:PENDING:1');
  assert.notEqual(kycQueueKey('PENDING', 1), kycQueueKey('PENDING', 2));
  const approved = buildKycVerdictFlex({ verdict: 'VERIFIED', fullNameTh: 'สมชาย', tenantName: 'acme', studioDeepLink: 'line://app/abc' });
  const rejected = buildKycVerdictFlex({ verdict: 'REJECTED', fullNameTh: 'สมชาย', tenantName: 'acme', rejectionReason: 'ภาพเบลอ กรุณาถ่ายใหม่' });
  assert.equal(approved.altText.includes('อนุมัติ'), true);
  assert.equal(rejected.altText.includes('เพิ่มเติม'), true);
  assert.ok(approved.contents.footer, 'approved carries studio CTA');
  assert.equal(rejected.contents.footer, undefined);
  assert.ok(kycFlexByteSize(approved) < KYC_FLEX_BUDGET_BYTES, `flex ${kycFlexByteSize(approved)}B < 10KB`);
  assert.ok(kycFlexByteSize(rejected) < KYC_FLEX_BUDGET_BYTES);
  ok('5. Queue budgets/keys + Flex builder (<10KB, CTA only on approve)');
}

// ---------- 6. Review service: atomic VERIFIED→SELLER (Gate 7) ----------
{
  const calls: { tx: string[]; published: unknown[]; notified: unknown[] } = { tx: [], published: [], notified: [] };
  const enc = new KycEncryptionService(KEY);
  const idEnc = enc.encrypt(VALID_ID);
  function mockPrisma(userRole: string, kycStatus = 'PENDING') {
    const txLog = calls.tx;
    const shared = {
      creatorKYC: {
        findUnique: async () => ({ id: KYC_ID, userId: USER_ID, status: kycStatus, firstNameTh: 'สมชาย', lastNameTh: 'ใจดี', bankAccountName: 'สมชาย ใจดี' }),
        findMany: async () => [],
        count: async () => 0,
        update: async (a: unknown) => { txLog.push(`kyc:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      user: {
        findUnique: async () => ({ id: USER_ID, role: userRole, lineUserId: 'U123' }),
        update: async (a: unknown) => { txLog.push(`user:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      creatorPayoutAccount: {
        findFirst: async () => ({ id: 'pay-1' }),
        update: async (a: unknown) => { txLog.push(`payout:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      kYCAuditLog: {
        create: async (a: unknown) => { txLog.push(`audit:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
    };
    return { ...shared, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(shared) };
  }
  const vault = { docViewUrl: (k: string) => ({ url: `https://vault.test/${k}?sig`, expiresInSec: 300 }) };
  const queue = { publish: async (...a: unknown[]) => { calls.published.push(a); } };
  const notify = { notify: async (...a: unknown[]) => { calls.notified.push(a); return { messageId: 'm1' }; } };
  const pii = new PiiCryptoService(enc);

  // 6a. MEMBER promotion
  calls.tx.length = 0; calls.published.length = 0; calls.notified.length = 0;
  const svcMember = new KycQueueReviewService(mockPrisma('MEMBER') as never, vault as never, pii, queue as never, notify as never);
  assert.equal(await svcMember.review({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { kycId: KYC_ID, status: 'VERIFIED' }, NET), true);
  assert.ok(calls.tx.some((t) => t.includes('"status":"VERIFIED"')), 'kyc VERIFIED in tx');
  assert.ok(calls.tx.some((t) => t.startsWith('user:') && t.includes('"role":"SELLER"')), 'MEMBER promoted to SELLER');
  assert.ok(calls.tx.some((t) => t.startsWith('audit:') && t.includes('APPROVED')), 'APPROVED audit in tx');
  assert.ok(calls.published.some((p) => (p as unknown[])[0] === 'kyc.approved'), 'kyc.approved published');
  assert.equal(calls.notified.length, 1);
  void idEnc;

  // 6b. existing SELLER keeps role (no downgrade/overwrite)
  calls.tx.length = 0;
  const svcSeller = new KycQueueReviewService(mockPrisma('SELLER') as never, vault as never, pii, queue as never, notify as never);
  await svcSeller.review({ id: ADMIN_ID, role: 'FINANCE_ADMIN' }, { kycId: KYC_ID, status: 'VERIFIED' }, NET);
  const userWrites = calls.tx.filter((t) => t.startsWith('user:'));
  assert.equal(userWrites.length, 1);
  assert.ok(!userWrites[0]!.includes('"role"'), 'role untouched for non-MEMBER');

  // 6c. REJECTED with reason → payout SUSPENDED + kyc.rejected
  calls.tx.length = 0; calls.published.length = 0;
  const svcReject = new KycQueueReviewService(mockPrisma('MEMBER') as never, vault as never, pii, queue as never, notify as never);
  assert.equal(
    await svcReject.review({ id: ADMIN_ID, role: 'CONTENT_MODERATOR' }, { kycId: KYC_ID, status: 'REJECTED', rejectionReason: 'ภาพเบลอ' }, NET),
    true,
  );
  assert.ok(calls.tx.some((t) => t.includes('SUSPENDED')), 'payout suspended');
  assert.ok(calls.published.some((p) => (p as unknown[])[0] === 'kyc.rejected'), 'kyc.rejected published');

  // 6d. guards: non-admin / missing reason / undecidable
  const svcGuard = new KycQueueReviewService(mockPrisma('MEMBER') as never, vault as never, pii, queue as never, notify as never);
  await assert.rejects(() => svcGuard.review({ id: ADMIN_ID, role: 'MEMBER' }, { kycId: KYC_ID, status: 'VERIFIED' }, NET), /admin role/);
  await assert.rejects(() => svcGuard.review({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { kycId: KYC_ID, status: 'REJECTED' }, NET), /reason/);
  const svcDone = new KycQueueReviewService(mockPrisma('MEMBER', 'VERIFIED') as never, vault as never, pii, queue as never, notify as never);
  await assert.rejects(() => svcDone.review({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { kycId: KYC_ID, status: 'VERIFIED' }, NET), /cannot be decided/);
  await assert.rejects(() => svcGuard.review({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { kycId: '', status: 'VERIFIED' }, NET), /Invalid KYC review/);
  ok('6. Atomic verdict: SELLER promotion/keep, reject suspend, 4 guards');
}

// ---------- 7. Queue listing: masked PII + 300s URLs + counters ----------
{
  const enc = new KycEncryptionService(KEY);
  const rows = [
    { id: KYC_ID, userId: USER_ID, status: 'PENDING', idCardNumberEnc: enc.encrypt(VALID_ID), idCardImageUrl: 'k/id.jpg', bankName: 'กสิกรไทย', bankAccountNumber: '1234567890', bankAccountName: 'สมชาย ใจดี', firstNameTh: 'สมชาย', lastNameTh: 'ใจดี', bookbankImageUrl: 'k/bb.jpg', riskLevel: 'HIGH', ocrConfidence: 0.72, createdAt: new Date('2026-09-01T00:00:00.000Z'), verifiedAt: null, rejectionReason: null },
  ];
  const prisma = {
    creatorKYC: {
      findMany: async () => rows,
      count: async (a: unknown) => {
        const w = (a as { where: Record<string, unknown> }).where;
        if (w['riskLevel']) return 1;
        if ((w['status'] as { in: string[] }).in.includes('VERIFIED')) return 0;
        return 1;
      },
      findUnique: async () => null,
      update: async () => ({}),
    },
    user: { findUnique: async () => null, update: async () => ({}) },
    creatorPayoutAccount: { findFirst: async () => null, update: async () => ({}) },
    kYCAuditLog: { create: async () => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
  };
  const vaultUrls: string[] = [];
  const vault = { docViewUrl: (k: string) => { vaultUrls.push(k); return { url: `https://vault.test/${k}?sig`, expiresInSec: 300 }; } };
  const svc = new KycQueueReviewService(
    prisma as never, vault as never, new PiiCryptoService(enc),
    { publish: async () => undefined } as never, { notify: async () => null } as never,
  );
  const out = await svc.getQueue('SUPER_ADMIN', { page: 1, limit: 20 });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0]!.idCardNumberMasked, '1-2345-XXXXX-12-1');
  assert.equal(out.items[0]!.bankAccountNumberMasked, 'XXX-X-X6789-X');
  assert.ok(!JSON.stringify(out.items).includes(VALID_ID), 'raw ID never leaks');
  assert.ok(out.items[0]!.idCardImageUrlSigned.startsWith('https://vault.test/k/id.jpg'), '300s signed id url');
  assert.ok(out.items[0]!.bankBookImageUrlSigned.startsWith('https://vault.test/k/bb.jpg'), '300s signed bank url');
  assert.deepEqual([out.totalCount, out.pendingCount, out.highRiskCount], [1, 1, 1]);
  await assert.rejects(() => svc.getQueue('MEMBER', {}), /admin role/);
  ok('7. Queue listing masked + signed URLs + counters + admin guard');
}

// ---------- 8. Risk engine: confidence/tamper/duplicate (§10.2) ----------
{
  const enc = new KycEncryptionService(KEY);
  async function assess(ocrConfidence: number, dupCount: number) {
    const prisma = {
      creatorKYC: {
        findUnique: async () => ({ id: KYC_ID, idCardNumberEnc: enc.encrypt(VALID_ID), ocrConfidence, payoutAccount: null }),
        count: async () => dupCount,
        update: async () => ({}),
      },
      kYCAuditLog: { create: async () => ({}) },
    };
    const svc = new KycRiskService(prisma as never, enc);
    return svc.assessAndStore(KYC_ID);
  }
  assert.deepEqual(await assess(0.97, 0), { riskLevel: 'LOW', duplicateId: false });
  const low = await assess(0.4, 0);
  assert.equal(low!.riskLevel, 'HIGH');
  assert.deepEqual(await assess(0.97, 1), { riskLevel: 'CRITICAL', duplicateId: true });
  const missing = new KycRiskService({ creatorKYC: { findUnique: async () => null } } as never, enc);
  assert.equal(await missing.assessAndStore('nope'), null);
  ok('8. Risk engine: LOW/HIGH(<50%)/CRITICAL(dup)/null-missing');
}

// ---------- 9. Webhook HMAC taxonomy (fail-closed 401) ----------
{
  const secret = 'phase111-webhook-secret';
  const body = JSON.stringify({ kycId: KYC_ID, confidenceScore: 97 });
  const good = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const check = (sig: string | undefined, key: string): boolean => {
    if (!sig || !key) return false;
    const c = createHmac('sha256', key).update(body, 'utf8').digest('hex');
    return sig.length === c.length && (() => { try { return require('node:crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(c)) as boolean; } catch { return false; } })();
  };
  assert.equal(check(good, secret), true);
  assert.equal(check(good.slice(0, -1) + '0', secret), false);
  assert.equal(check(good, 'wrong'), false);
  assert.equal(check(undefined, secret), false);
  ok('9. Webhook HMAC mint/verify/forgery/secret-mismatch taxonomy');
}

// ---------- 10. Prisma Gate 1 + SDL + api alias (SSOT sync) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  assert.ok(prisma.includes('enum KYCRiskLevel'), 'KYCRiskLevel enum');
  assert.ok(prisma.includes('riskLevel         KYCRiskLevel @default(LOW)'), 'CreatorKYC.riskLevel');
  assert.ok(prisma.includes('isPossibleTamper'), 'CreatorKYC.isPossibleTamper');
  assert.ok(prisma.includes('idCardBlindIdx'), 'CreatorKYC.idCardBlindIdx');
  assert.ok(prisma.includes('@@index([riskLevel])'), 'riskLevel index');
  assert.ok(prisma.includes('@@index([createdAt])'), '111 queue ordering index');
  assert.ok(prisma.includes('@@index([idCardBlindIdx])'), 'blind-index lookup index');
  const sdl = readFileSync('apps/backend/src/api/graphql/kyc/kyc.graphql', 'utf8');
  for (const t of ['type KycDetailPayload', 'type KycQueuePaginatedResponse', 'getKycVerificationQueue', 'reviewCreatorKyc', 'submitCreatorKyc']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const alias = readFileSync('apps/backend/src/api/graphql/kyc.resolver.ts', 'utf8');
  assert.ok(alias.includes('KycQueueResolver'), 'api alias re-exports 111 resolver');
  assert.ok(!alias.includes('KycResolverResolver'), 'scaffold placeholder retired');
  const webhook = readFileSync('apps/backend/src/api/webhooks/kyc/kyc-ocr-callback.controller.ts', 'utf8');
  assert.ok(webhook.includes('x-kyc-signature') && webhook.includes('timingSafeEqual'), 'HMAC-guarded OCR callback');
  ok('10. Prisma Gate 1 + SDL §3.2 + api alias + webhook file');
}

// ---------- 11. Frontend Gate 3/5 (5 states, RAM guard, secure viewport) ----------
{
  const page = readFileSync('apps/frontend/app/(admin)/admin/kyc-queue/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `queue page state ${s}`);
  }
  const ws = readFileSync('apps/frontend/components/kyc/KycQueueWorkspace.tsx', 'utf8');
  assert.ok(ws.includes('F8') && ws.includes('F9'), 'F8/F9 quick actions');
  assert.ok(ws.includes('onContextMenu'), 'secure viewport context-menu block');
  assert.ok(ws.includes('risk-badge') && ws.includes('GREEN') && ws.includes('RED'), 'risk badges');
  const proc = readFileSync('apps/frontend/lib/kyc/kyc-document-processor.ts', 'utf8');
  assert.ok(proc.includes('1920') && proc.includes('1080'), '1920x1080 cap');
  assert.ok(proc.includes('image/webp') && proc.includes('0.85'), 'WebP 0.85');
  assert.ok(proc.includes('revokeObjectURL'), 'RAM guard revoke');
  assert.ok(proc.includes('processKycDocumentImage'), 'spec-verbatim fn');
  const qProxy = readFileSync('apps/frontend/app/api/v1/admin/kyc111/queue/route.ts', 'utf8');
  const rProxy = readFileSync('apps/frontend/app/api/v1/admin/kyc111/review/route.ts', 'utf8');
  assert.ok(qProxy.includes('/api/v1/admin/kyc111/queue'), 'queue proxy target');
  assert.ok(rProxy.includes('/api/v1/admin/kyc111/review'), 'review proxy target');
  ok('11. Frontend 5-state + F8/F9 + secure viewport + WebP/RAM guard + proxies');
}

// ---------- 12. Barrel + module wiring (Gate 1/9 prep) ----------
{
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['KycSubmissionInputSchema', 'KycReviewPayloadSchema', 'OcrExtractionResultSchema', 'kycRiskTier111', 'KYC_DOC_VIEW_TTL_SEC']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  const mod = readFileSync('apps/backend/src/modules/kyc/kyc.module.ts', 'utf8');
  for (const p of ['PiiCryptoService', 'KycRiskService', 'KycQueueReviewService', 'KycQueueResolver', 'KycQueueController']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  const webhooks = readFileSync('apps/backend/src/api/webhooks/webhooks.module.ts', 'utf8');
  assert.ok(webhooks.includes('KycOcrCallbackController'), 'webhooks module mounts OCR callback');
  ok('12. Barrel exports + KycModule/WebhooksModule wiring');
}
}

main()
  .then(() => console.log(`\nPhase 111 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 111 contracts FAILED:', err);
    process.exit(1);
  });
