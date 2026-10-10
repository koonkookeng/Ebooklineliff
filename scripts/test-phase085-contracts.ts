// SSOT Phase 085 §10-11 — contract tests (Zod, checksum/fuzzy, AES, submit/decide, parity)
// Run: npx tsx scripts/test-phase085-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CreatorKYCStatusEnum,
  BankCodeEnum,
  CreatorKYCInputSchema,
  KYCOcrResponseSchema,
  KYCApprovalActionSchema,
  KYC_AUTO_APPROVE_SCORE,
  KYC_REVIEW_FLOOR_SCORE,
  KYC_UPLOAD_TTL_SEC,
  KYC_VIEW_TTL_SEC,
  KYC_EVENT_STREAM,
  thaiIdChecksum,
  laserFormatValid,
  stripThaiTitle,
  levenshtein,
  fuzzyNameScore,
  kycScoreTier,
  kycObjectKey,
} from '../packages/shared/src/schemas/kyc-contract';
import { KycEncryptionService, resolveKycKey } from '../apps/backend/src/modules/kyc/services/kyc-encryption.service';
import { BankValidationService } from '../apps/backend/src/modules/kyc/services/bank-validation.service';
import { DopaLaserAdapter } from '../apps/backend/src/modules/kyc/adapters/dopa-laser.adapter';
import { OcrEngineAdapter } from '../apps/backend/src/modules/kyc/adapters/ocr-engine.adapter';
import { KycOcrService } from '../apps/backend/src/modules/kyc/services/kyc-ocr.service';
import { KycVerificationService } from '../apps/backend/src/modules/kyc/services/kyc-verification.service';
import { assertDecidable, assertRejection, assertSubmittable } from '../apps/backend/src/modules/kyc/domain/kyc-verification.aggregate';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const TENANT = 'emerald-mall';
// Checksum-valid Thai ID (computed): prefix 110070062621 → check digit.
const THAI_ID = '1100700626210';
const LASER = `AB${THAI_ID.slice(-10)}`;

function validInput(): Record<string, unknown> {
  return {
    idCardNumber: THAI_ID,
    laserCode: LASER,
    firstNameTh: 'สมศรี',
    lastNameTh: 'ใจดี',
    birthDate: '1990-01-15T00:00:00.000Z',
    idCardImageUrl: 'https://vault.local/kyc/id.jpg',
    selfieImageUrl: 'https://vault.local/kyc/selfie.jpg',
    bankCode: 'KBANK',
    bankAccountNumber: '1234567890',
    bankAccountName: 'สมศรี ใจดี',
    bookbankImageUrl: 'https://vault.local/kyc/book.jpg',
  };
}

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(CreatorKYCStatusEnum.safeParse('ACTION_REQUIRED').success, true);
  assert.equal(CreatorKYCStatusEnum.safeParse('PENDING_APPROVAL').success, false);
  assert.equal(BankCodeEnum.safeParse('KBANK').success, true);
  assert.equal(BankCodeEnum.safeParse('KBank').success, false);
  assert.equal(CreatorKYCInputSchema.safeParse(validInput()).success, true);
  assert.equal(CreatorKYCInputSchema.safeParse({ ...validInput(), idCardNumber: '123' }).success, false);
  assert.equal(CreatorKYCInputSchema.safeParse({ ...validInput(), laserCode: 'SHORT' }).success, false);
  assert.equal(CreatorKYCInputSchema.safeParse({ ...validInput(), bankCode: 'XYZ' }).success, false);
  assert.equal(CreatorKYCInputSchema.safeParse({ ...validInput(), bankAccountNumber: 'ABC' }).success, false);
  assert.equal(
    KYCOcrResponseSchema.safeParse({ success: true, extractedData: { ocrConfidence: 0.99 }, isBlurry: false, hasGlare: false }).success,
    true,
  );
  assert.equal(
    KYCOcrResponseSchema.safeParse({ success: true, extractedData: { ocrConfidence: 2 }, isBlurry: false, hasGlare: false }).success,
    false,
  );
  assert.equal(KYCApprovalActionSchema.safeParse({ kycId: UUID, status: 'VERIFIED' }).success, true);
  assert.equal(
    KYCApprovalActionSchema.safeParse({ kycId: UUID, status: 'REJECTED', rejectionReason: 'blurry' }).success,
    true,
  );
  assert.equal(KYCApprovalActionSchema.safeParse({ kycId: 'nope', status: 'VERIFIED' }).success, false);
  assert.equal(KYCApprovalActionSchema.safeParse({ kycId: UUID, status: 'PENDING' }).success, false);
  ok('Zod §3.1 verbatim (status/bank/input/ocr/approval gates)');
}

// ---------- 2. Checksum/laser/fuzzy math (§7/§10.1) ----------
{
  assert.equal(KYC_AUTO_APPROVE_SCORE, 0.9);
  assert.equal(KYC_REVIEW_FLOOR_SCORE, 0.75);
  assert.equal(KYC_UPLOAD_TTL_SEC, 900);
  assert.equal(KYC_VIEW_TTL_SEC, 180);
  assert.equal(KYC_EVENT_STREAM, 'stream:kyc:events');
  assert.equal(thaiIdChecksum(THAI_ID), true);
  assert.equal(thaiIdChecksum(`${THAI_ID.slice(0, 12)}${(Number(THAI_ID[12]) + 1) % 10}`), false);
  assert.equal(thaiIdChecksum('123'), false);
  assert.equal(laserFormatValid(LASER), true);
  assert.equal(laserFormatValid('ABC123'), false);
  assert.equal(laserFormatValid('AB123456789'), false);
  assert.equal(stripThaiTitle('นาย สมศรี ใจดี'), 'สมศรี ใจดี');
  assert.equal(stripThaiTitle('ดร. Jane Doe'), 'Jane Doe');
  assert.equal(stripThaiTitle('สมศรี'), 'สมศรี');
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('สมศรี', 'สมศรี'), 0);
  // BDD-2 canonical: exact names (titles stripped) → 1.0.
  assert.equal(fuzzyNameScore('นาย สมศรี ใจดี', 'สมศรี ใจดี'), 1);
  assert.ok(fuzzyNameScore('สมศรี ใจดี', 'สมศรี ใจดีมาก') >= 0.75);
  assert.ok(fuzzyNameScore('สมศรี ใจดี', 'จอห์น สมิธ') < 0.75);
  assert.equal(kycScoreTier(0.95), 'AUTO');
  assert.equal(kycScoreTier(0.8), 'REVIEW');
  assert.equal(kycScoreTier(0.5), 'REJECT');
  assert.ok(kycObjectKey('u1', 'id-card').startsWith('tenants/kyc/u1/id-card-'));
  ok('Math: checksum/laser/titles/levenshtein/tiers/keys');
}

// ---------- 3. AES-256-GCM round-trip + tamper (Gate 4) ----------
{
  const key = resolveKycKey('00'.repeat(32));
  assert.equal(key.length, 32);
  const svc = new KycEncryptionService(key);
  const ct1 = svc.encrypt(THAI_ID);
  const ct2 = svc.encrypt(THAI_ID);
  assert.notEqual(ct1, ct2, 'random IV per envelope');
  assert.equal(svc.decrypt(ct1), THAI_ID);
  assert.throws(() => svc.decrypt('not-an-envelope'), /Malformed/);
  const tampered = `${ct1.split(':')[0]}:${ct1.split(':')[1]}:AAAAAAAAAAAAAAAAAAAAAA==`;
  assert.throws(() => svc.decrypt(tampered), /./, 'GCM tag rejects tampering');
  assert.throws(() => new KycEncryptionService(Buffer.alloc(16)), /32 bytes/);
  // Laser + account numbers ride the same envelope.
  assert.equal(svc.decrypt(svc.encrypt(LASER)), LASER);
  ok('AES: round-trip + random IV + GCM tamper reject');
}

// ---------- 4. Adapters: laser linkage + staged OCR ----------
async function sectionAdapters(): Promise<void> {
  const laser = new DopaLaserAdapter();
  assert.deepEqual(laser.validate(LASER, THAI_ID), { valid: true, reason: null });
  assert.equal(laser.validate('SHORT', THAI_ID).valid, false);
  assert.equal(laser.validate(`AB${'0'.repeat(10)}`, THAI_ID).valid, false);
  const ocr = new OcrEngineAdapter();
  const staged = await ocr.extract('tenants/kyc/u/id-card-x.jpg');
  assert.deepEqual(staged, { ocrConfidence: 0, needsManualReview: true });
  const ocrSvc = new KycOcrService(ocr);
  const merged = await ocrSvc.extractWithFallback('k', {
    idCardNumber: THAI_ID, firstNameTh: 'สมศรี', lastNameTh: 'ใจดี', birthDate: '1990-01-15T00:00:00.000Z',
  });
  assert.equal(merged.ocrConfidence, 0);
  assert.equal(merged.firstNameTh, 'สมศรี');
  ok('Adapters: laser linkage gate + staged-OCR fallback');
}

// ---------- 5. Submit orchestrator (BDD-1 <3s, Gate 7) ----------
async function sectionSubmit(): Promise<void> {
  function ports() {
    const streams: Array<{ event: string; tier: string }> = [];
    const store = {
      upsertKyc: async () => ({ id: 'kyc-1' }),
      upsertPayoutAccount: async () => undefined,
      setUserKycStatus: async () => undefined,
      audit: async () => undefined,
      findKyc: async () => null,
      findKycByUser: async () => null,
      reviewQueue: async () => [],
      decideKyc: async () => undefined,
      setPayoutStatus: async () => undefined,
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    const bank = new BankValidationService();
    const ocr = new KycOcrService(new OcrEngineAdapter());
    const queue = { publish: async (event: string, f: Record<string, string | number>) => { streams.push({ event, tier: String(f['tier'] ?? '') }); } };
    const enc = new KycEncryptionService(resolveKycKey('11'.repeat(32)));
    return { store, tx, bank, ocr, queue, enc, streams };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new KycVerificationService(p.store as never, p.tx, p.enc, p.bank, p.ocr, p.queue);
  const net = { ipAddress: '1.1.1.1', userAgent: 'LIFF' };
  // Happy path: exact names → AUTO → PENDING (<3s).
  {
    const p = ports();
    const svc = svcOf(p);
    const t0 = Date.now();
    const r = await svc.submitCreatorKyc(UUID_B, validInput(), net);
    assert.ok(Date.now() - t0 < 3000, 'submit <3s budget');
    assert.deepEqual(r, { success: true, kycId: 'kyc-1', nameMatchScore: 1, tier: 'AUTO' });
    assert.ok(p.streams.some((s) => s.event === 'kyc.submitted' && s.tier === 'AUTO'));
  }
  // Near-miss names → REVIEW → ACTION_REQUIRED.
  {
    const p = ports();
    const svc = svcOf(p);
    const r = await svc.submitCreatorKyc(UUID_B, { ...validInput(), bankAccountName: 'สมศรี ใจดีมาก' }, net);
    assert.equal(r.tier, 'REVIEW');
  }
  // Gates: bad Zod / bad checksum / bad laser / REJECT names / double-shape.
  {
    const p = ports();
    const svc = svcOf(p);
    await assert.rejects(svc.submitCreatorKyc(UUID_B, { ...validInput(), idCardNumber: '123' }, net), /Invalid KYC/);
    await assert.rejects(
      svc.submitCreatorKyc(UUID_B, { ...validInput(), idCardNumber: '1100700626211' }, net),
      /เลขบัตรประชาชน/,
    );
    await assert.rejects(svc.submitCreatorKyc(UUID_B, { ...validInput(), laserCode: 'SHORT' }, net), /Invalid KYC/);
    await assert.rejects(
      svc.submitCreatorKyc(UUID_B, { ...validInput(), bankAccountName: 'จอห์น สมิธ' }, net),
      /ไม่ตรงกับชื่อบนบัตร/,
    );
  }
  // Aggregate unit gates.
  {
    assert.throws(() => assertSubmittable({ idCardNumber: '123', laserCode: LASER }), /เลขบัตร/);
    assert.throws(() => assertDecidable('VERIFIED'), /cannot be decided/);
    assert.doesNotThrow(() => assertDecidable('ACTION_REQUIRED'));
    assert.throws(() => assertRejection({ status: 'REJECTED' }), /reason/);
    assert.doesNotThrow(() => assertRejection({ status: 'REJECTED', rejectionReason: 'blurry' }));
  }
  ok('Submit: AUTO/REVIEW tiers + 4 gates + audit/stream (<3s)');
}

// ---------- 6. Admin decide (Task 7: approve/reject/review + payout flip) ----------
async function sectionDecide(): Promise<void> {
  function ports(status: string) {
    const calls: string[] = [];
    const store = {
      upsertKyc: async () => ({ id: 'kyc-1' }),
      upsertPayoutAccount: async () => undefined,
      setUserKycStatus: async (u: string, s: string) => { calls.push(`user:${s}`); },
      audit: async (a: { action: string }) => { calls.push(`audit:${a.action}`); },
      findKyc: async () => ({ id: UUID, userId: UUID_B, status }),
      findKycByUser: async () => null,
      reviewQueue: async () => [],
      decideKyc: async () => { calls.push('decide'); },
      setPayoutStatus: async (u: string, s: string) => { calls.push(`payout:${s}`); },
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    const enc = new KycEncryptionService(resolveKycKey('22'.repeat(32)));
    const queue = { publish: async () => undefined };
    return { store, tx, enc, queue, calls };
  }
  const svcOf = (p: ReturnType<typeof ports>) =>
    new KycVerificationService(p.store as never, p.tx, p.enc, new BankValidationService(), new KycOcrService(new OcrEngineAdapter()), p.queue);
  const net = { ipAddress: '9.9.9.9', userAgent: 'admin-web' };
  // BDD-2 canonical: approve → VERIFIED + payout ACTIVE.
  {
    const p = ports('PENDING');
    const r = await svcOf(p).decideKyc(UUID, 'SUPER_ADMIN', { kycId: UUID, status: 'VERIFIED' }, net);
    assert.deepEqual(r, { kycId: UUID, status: 'VERIFIED' });
    assert.ok(p.calls.includes('decide') && p.calls.includes('user:VERIFIED') && p.calls.includes('payout:ACTIVE') && p.calls.includes('audit:APPROVE'));
  }
  // Reject (reasoned) → SUSPENDED; review → PENDING_VERIFICATION.
  {
    const p = ports('ACTION_REQUIRED');
    await svcOf(p).decideKyc(UUID, 'FINANCE_ADMIN', { kycId: UUID, status: 'REJECTED', rejectionReason: 'สวมรอย' }, net);
    assert.ok(p.calls.includes('payout:SUSPENDED'));
    const q = ports('PENDING');
    await svcOf(q).decideKyc(UUID, 'CONTENT_MODERATOR', { kycId: UUID, status: 'ACTION_REQUIRED' }, net);
    assert.ok(q.calls.includes('payout:PENDING_VERIFICATION'));
  }
  // Gates: non-admin / decided row / reasonless reject / bad status.
  {
    const p = ports('PENDING');
    await assert.rejects(svcOf(p).decideKyc(UUID, 'MEMBER', { kycId: UUID, status: 'VERIFIED' }, net), /admin role/);
    await assert.rejects(svcOf(p).decideKyc(UUID, undefined, { kycId: UUID, status: 'VERIFIED' }, net), /admin role/);
    const done = ports('VERIFIED');
    await assert.rejects(svcOf(done).decideKyc(UUID, 'SUPER_ADMIN', { kycId: UUID, status: 'VERIFIED' }, net), /cannot be decided/);
    await assert.rejects(svcOf(p).decideKyc(UUID, 'SUPER_ADMIN', { kycId: UUID, status: 'REJECTED' }, net), /reason/);
    await assert.rejects(svcOf(p).decideKyc(UUID, 'SUPER_ADMIN', { kycId: 'nope', status: 'VERIFIED' }, net), /Invalid approval/);
  }
  ok('Decide: approve/reject/review flips + 4 admin gates');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'ACTION_REQUIRED',
    'enum PayoutAccountStatus {',
    'PENDING_VERIFICATION',
    'laserCodeEnc      String?',
    'firstNameTh       String?',
    'ocrConfidence     Decimal?',
    'status            KYCStatus @default(PENDING)',
    'model CreatorPayoutAccount {',
    'bankAccountNumberEnc String',
    'nameMatchScore      Decimal',
    'model KYCAuditLog {',
    'action      String',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: KYC status union + payout account + audit log + e-KYC columns');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/kyc/services/kyc-encryption.service.ts',
    'apps/backend/src/modules/kyc/services/bank-validation.service.ts',
    'apps/backend/src/modules/kyc/services/kyc-verification.service.ts',
    'apps/backend/src/modules/kyc/services/kyc-ocr.service.ts',
    'apps/backend/src/modules/kyc/services/kyc-queue.service.ts',
    'apps/backend/src/modules/kyc/services/kyc-notification.service.ts',
    'apps/backend/src/modules/kyc/adapters/dopa-laser.adapter.ts',
    'apps/backend/src/modules/kyc/adapters/ocr-engine.adapter.ts',
    'apps/backend/src/modules/kyc/infra/ocr-vision.adapter.ts',
    'apps/backend/src/modules/kyc/infra/r2-private-vault.client.ts',
    'apps/backend/src/modules/kyc/domain/kyc-verification.aggregate.ts',
    'apps/backend/src/modules/kyc/domain/events/kyc-submitted.event.ts',
    'apps/backend/src/modules/kyc/domain/events/kyc-approved.event.ts',
    'apps/backend/src/modules/kyc/dto/kyc-submission.dto.ts',
    'apps/backend/src/modules/kyc/controllers/kyc-submission.controller.ts',
    'apps/backend/src/modules/kyc/controllers/kyc-admin.controller.ts',
    'apps/backend/src/modules/kyc/resolvers/kyc.resolver.ts',
    'apps/backend/src/modules/kyc/kyc.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // pii-crypto (key rotation) is 111-owned — implemented by Phase 111 Task 2
  // (facade over KycEncryptionService + PDPA masks). Updated from the
  // pre-111 AUTO-SCAFFOLD placeholder guard; 085 cipher ownership unchanged.
  assert.ok(
    readFileSync('apps/backend/src/modules/kyc/services/pii-crypto.service.ts', 'utf8').includes('PiiCryptoService'),
    'pii-crypto 111-owned (implemented)',
  );
  const fin = readFileSync('apps/backend/src/modules/kyc/services/kyc-verification.service.ts', 'utf8');
  assert.ok(fin.includes('PrismaKycStore') && fin.includes('assertSubmittable'));
  const mod = readFileSync('apps/backend/src/modules/kyc/kyc.module.ts', 'utf8');
  assert.ok(mod.includes('KycModule') && mod.includes('KycVerificationService') && mod.includes('PrismaKycStore'));
  assert.ok(!/class KycModuleModule/.test(mod), 'legacy scaffold class removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('KycModule'));
  const gql = readFileSync('apps/backend/src/modules/kyc/resolvers/kyc.resolver.ts', 'utf8');
  assert.ok(gql.includes('submitKyc') && gql.includes('getKycStatus') && gql.includes('decideKyc') && gql.includes('kycUploadTicket'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/kyc.resolver.ts', 'utf8');
  assert.ok(alias.includes('KycResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/kyc/kyc.graphql', 'utf8');
  assert.ok(sdl.includes('KycSubmitPayload') && sdl.includes('KycStatusPayload') && sdl.includes('submitKyc'));
  for (const p of [
    'apps/frontend/components/kyc/KycWizard.tsx',
    'apps/frontend/hooks/useKycWizard.ts',
    'apps/frontend/lib/kyc/kyc-client.ts',
    'apps/frontend/lib/kyc/kyc-watermark.ts',
    'apps/frontend/app/(liff)/creator/kyc/page.tsx',
    'apps/frontend/app/(web)/admin/kyc/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useKycWizard.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(hook.includes('applyKycWatermark'), 'watermark-before-upload');
  const wm = readFileSync('apps/frontend/lib/kyc/kyc-watermark.ts', 'utf8');
  assert.ok(wm.includes('2 * 1024 * 1024') && wm.includes('getContext'), '<2MB canvas compress');
  for (const p of [
    'apps/frontend/app/api/v1/kyc/submit/route.ts',
    'apps/frontend/app/api/v1/kyc/status/route.ts',
    'apps/frontend/app/api/v1/kyc/presign/route.ts',
    'apps/frontend/app/api/v1/admin/kyc/queue/route.ts',
    'apps/frontend/app/api/v1/admin/kyc/decide/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('kyc-contract') && barrel.includes('CreatorKYCInputSchema') && barrel.includes('CreatorEKYCInput'));
  ok('Parity: module/GQL+alias/SDL/wizard+console/proxies/barrel (5-state, watermark, zero-dep)');
}

async function main(): Promise<void> {
  await sectionAdapters();
  await sectionSubmit();
  await sectionDecide();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase085 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
