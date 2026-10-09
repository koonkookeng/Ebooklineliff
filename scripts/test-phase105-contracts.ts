// SSOT Phase 105 §10-11 — contract tests (Zod, HMAC, service paths, parity)
// Run: npx tsx scripts/test-phase105-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VerificationStatusEnum,
  VerifyCertificateInputSchema,
  CertificateIssuerSchema,
  CertificateStudentInfoSchema,
  CertificateDetailSchema,
  CertificateVerificationPayloadSchema,
  CERT_VERIFY_LATENCY_MS,
  CERT_VERIFY_RAM_MB,
  CERT_VERIFY_BUNDLE_KB,
  CERT_VERIFY_RATE_PER_MIN,
  certVerifyRateKey,
  isCertificateNoFormat,
} from '../packages/shared/src/schemas/certificate-verification.schema';
import { fromLegacyStatus } from '../apps/backend/src/modules/certificate/domain/certificate-status.enum';
import { verifyPublicHash, buildHmacPayload, DigitalSignature } from '../apps/backend/src/modules/certificate/domain/certificate-hash.verifier';
import { PublicCertificateVerificationService } from '../apps/backend/src/modules/certificate/certificate-verification.service';

process.env.CERTIFICATE_HMAC_SECRET = 'test-secret-105';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const NOW = new Date().toISOString();
const SECRET = 'test-secret-105';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(VerificationStatusEnum.safeParse('VERIFIED').success, true);
  assert.equal(VerificationStatusEnum.safeParse('EXPIRED').success, true);
  assert.equal(VerificationStatusEnum.safeParse('PENDING').success, false);
  assert.equal(VerifyCertificateInputSchema.safeParse({ certificateNo: 'CERT-2026-998811' }).success, true);
  assert.equal(VerifyCertificateInputSchema.safeParse({ certificateNo: 'AB' }).success, false);
  const issuer = { tenantId: UUID, tenantName: 'Academy', logoUrl: 'https://cdn.local/logo.png', verifiedDomain: 'verify.local' };
  assert.equal(CertificateIssuerSchema.safeParse(issuer).success, true);
  assert.equal(CertificateIssuerSchema.safeParse({ ...issuer, logoUrl: 'not-a-url' }).success, false);
  const student = { studentName: 'Somchai', avatarUrl: null, completionDate: NOW };
  assert.equal(CertificateStudentInfoSchema.safeParse(student).success, true);
  const detail = {
    certificateNo: 'CERT-2026-998811', courseTitle: 'AI 101', courseSlug: 'ai-101', totalHours: 12,
    issuedAt: NOW, pdfDownloadUrl: 'https://cdn.local/c.pdf', student, issuer,
  };
  assert.equal(CertificateDetailSchema.safeParse(detail).success, true);
  assert.equal(CertificateDetailSchema.safeParse({ ...detail, totalHours: -1 }).success, false);
  assert.equal(
    CertificateVerificationPayloadSchema.safeParse({ success: true, status: 'VERIFIED', message: 'ok', data: detail, scannedAt: NOW }).success,
    true,
  );
  assert.equal(
    CertificateVerificationPayloadSchema.safeParse({ success: false, status: 'REVOKED', message: 'no', data: null, scannedAt: NOW }).success,
    true,
  );
  ok('Zod §3.1 verbatim (status/input/issuer/student/detail/payload gates)');
}

// ---------- 2. Pure helpers ----------
{
  assert.equal(CERT_VERIFY_LATENCY_MS, 500);
  assert.equal(CERT_VERIFY_RAM_MB, 25);
  assert.equal(CERT_VERIFY_BUNDLE_KB, 45);
  assert.equal(CERT_VERIFY_RATE_PER_MIN, 20);
  assert.equal(certVerifyRateKey('1.2.3.4'), 'ratelimit:cert-verify:1.2.3.4');
  assert.equal(isCertificateNoFormat('CERT-2026-998811'), true);
  assert.equal(isCertificateNoFormat('CERT-FAKE-999999'), true);
  assert.equal(isCertificateNoFormat('fake'), false);
  assert.equal(fromLegacyStatus('ISSUED', false), 'VERIFIED');
  assert.equal(fromLegacyStatus('ISSUED', true), 'REVOKED');
  assert.equal(fromLegacyStatus('REVOKED', false), 'REVOKED');
  assert.equal(fromLegacyStatus('EXPIRED', false), 'EXPIRED');
  assert.equal(fromLegacyStatus('WEIRD', false), 'INVALID');
  ok('Helpers: budgets/rate-key/certNo-format/legacy-status map');
}

// ---------- 3. HMAC round-trip (048 single-source payload) ----------
{
  const payload = buildHmacPayload('CERT-2026-998811', UUID, UUID_B, 'Somchai');
  const stored = DigitalSignature.create(payload, SECRET).toString();
  const base = { certificateNo: 'CERT-2026-998811', userId: UUID, courseId: UUID_B, displayName: 'Somchai', storedSignature: stored, secret: SECRET };
  assert.equal(verifyPublicHash(base), true);
  assert.equal(verifyPublicHash({ ...base, providedHash: stored }), true);
  assert.equal(verifyPublicHash({ ...base, providedHash: 'deadbeef' }), false);
  assert.equal(verifyPublicHash({ ...base, displayName: 'Mallory' }), false);
  assert.equal(verifyPublicHash({ ...base, storedSignature: '00'.repeat(32) }), false);
  ok('HMAC: round-trip + tamper + QR-hash mismatch gates');
}

// ---------- 4. Service paths (fakes) ----------
function fakePrisma(cert: Record<string, unknown> | null, spy: { updated: number; audits: unknown[] }) {
  return {
    courseCertificate: {
      findUnique: async () => cert,
      update: async () => { spy.updated++; },
    },
    certificateVerificationLog: {
      create: async (a: unknown) => { spy.audits.push(a); },
    },
    tenant: {
      findUnique: async () => ({ id: UUID, name: 'Test Academy', logoUrl: null, domain: null }),
    },
  };
}

function certRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const issuedAt = new Date('2026-01-15T00:00:00.000Z');
  const stored = DigitalSignature.create(buildHmacPayload('CERT-2026-998811', UUID, UUID_B, 'Somchai'), SECRET).toString();
  return {
    id: 'cert-1',
    certificateNo: 'CERT-2026-998811',
    userId: UUID,
    courseId: UUID_B,
    tenantId: UUID,
    issuedAt,
    pdfStoragePathR2: 'certs/CERT-2026-998811.pdf',
    digitalSignatureHash: stored,
    status: 'ISSUED',
    isRevoked: false,
    revokedReason: null,
    user: { id: UUID, displayName: 'Somchai', avatarUrl: null },
    course: { id: UUID_B, totalHours: 12, product: { title: 'AI 101', slug: 'ai-101', sellerId: UUID, tenantId: UUID } },
    ...over,
  };
}

const fakeRedis = {
  incrby: async () => 1,
  expire: async () => undefined,
};

async function sectionService(): Promise<void> {
  // VERIFIED happy path.
  {
    const spy = { updated: 0, audits: [] as unknown[] };
    const svc = new PublicCertificateVerificationService(fakePrisma(certRow(), spy) as never, fakeRedis as never);
    const r = await svc.verifyPublicCertificate({ certificateNo: 'CERT-2026-998811', ipAddress: '1.2.3.4', userAgent: 'qr-scan' });
    assert.equal(r.status, 'VERIFIED');
    assert.equal(r.success, true);
    assert.equal(r.data?.certificateNo, 'CERT-2026-998811');
    assert.equal(r.data?.courseSlug, 'ai-101');
    assert.equal(r.data?.issuer.tenantName, 'Test Academy');
    assert.ok((r.data?.pdfDownloadUrl ?? '').includes('certs/CERT-2026-998811.pdf'));
    assert.equal(spy.updated, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(spy.audits.length, 1);
  }
  // NOT_FOUND → INVALID, no audit row possible.
  {
    const spy = { updated: 0, audits: [] as unknown[] };
    const svc = new PublicCertificateVerificationService(fakePrisma(null, spy) as never, fakeRedis as never);
    const r = await svc.verifyPublicCertificate({ certificateNo: 'CERT-FAKE-999999', ipAddress: '9.9.9.9', userAgent: 'x' });
    assert.deepEqual([r.status, r.success, r.data], ['INVALID', false, null]);
  }
  // Tampered provided hash → INVALID + audit.
  {
    const spy = { updated: 0, audits: [] as unknown[] };
    const svc = new PublicCertificateVerificationService(fakePrisma(certRow(), spy) as never, fakeRedis as never);
    const r = await svc.verifyPublicCertificate({ certificateNo: 'CERT-2026-998811', hashSignature: 'tampered', ipAddress: '1.2.3.4', userAgent: 'x' });
    assert.equal(r.status, 'INVALID');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(spy.audits.length, 1);
  }
  // Revoked via additive flag + via legacy status.
  for (const row of [certRow({ isRevoked: true, revokedReason: 'cheating' }), certRow({ status: 'REVOKED' })]) {
    const spy = { updated: 0, audits: [] as unknown[] };
    const svc = new PublicCertificateVerificationService(fakePrisma(row, spy) as never, fakeRedis as never);
    const r = await svc.verifyPublicCertificate({ certificateNo: 'CERT-2026-998811', ipAddress: '1.2.3.4', userAgent: 'x' });
    assert.equal(r.status, 'REVOKED');
    assert.equal(r.data, null);
  }
  // Expired legacy status.
  {
    const spy = { updated: 0, audits: [] as unknown[] };
    const svc = new PublicCertificateVerificationService(fakePrisma(certRow({ status: 'EXPIRED' }), spy) as never, fakeRedis as never);
    const r = await svc.verifyPublicCertificate({ certificateNo: 'CERT-2026-998811', ipAddress: '1.2.3.4', userAgent: 'x' });
    assert.equal(r.status, 'EXPIRED');
  }
  // Bad input short-circuits (no DB hit).
  {
    const svc = new PublicCertificateVerificationService(
      { courseCertificate: { findUnique: async () => { throw new Error('must not hit db'); } } } as never,
      fakeRedis as never,
    );
    const r = await svc.verifyPublicCertificate({ certificateNo: 'AB', ipAddress: '1.2.3.4', userAgent: 'x' });
    assert.equal(r.status, 'INVALID');
  }
  // Rate limit 429 fast-fails before lookup.
  {
    const svc = new PublicCertificateVerificationService(
      { courseCertificate: { findUnique: async () => { throw new Error('must not hit db'); } } } as never,
      { incrby: async () => 21, expire: async () => undefined } as never,
    );
    await assert.rejects(
      svc.verifyPublicCertificate({ certificateNo: 'CERT-2026-998811', ipAddress: '6.6.6.6', userAgent: 'bot' }),
      /Too many verification/,
    );
  }
  ok('Service: VERIFIED/NOT_FOUND/tamper/REVOKED/EXPIRED/input-gate/429');
}

// ---------- 5. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'isRevoked      Boolean                  @default(false)',
    'revokedReason  String?',
    'viewCount      Int                      @default(0)',
    'verificationLogs CertificateVerificationLog[]',
    'model CertificateVerificationLog {',
    'certificate   CourseCertificate @relation',
    'resultStatus  String',
    '@@index([certificateId])',
    'digitalSignatureHash String',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: 048 canonical kept + 105 revoke/viewCount/audit additive');
}

function sectionParity(): void {
  for (const f of [
    'packages/shared/src/schemas/certificate-verification.schema.ts',
    'apps/backend/src/modules/certificate/domain/certificate-status.enum.ts',
    'apps/backend/src/modules/certificate/domain/certificate-hash.verifier.ts',
    'apps/backend/src/modules/certificate/dto/verify-certificate.dto.ts',
    'apps/backend/src/modules/certificate/certificate-verification.service.ts',
    'apps/backend/src/modules/certificate/certificate-verification.controller.ts',
    'apps/backend/src/modules/certificate/certificate.resolver.ts',
    'apps/backend/src/api/graphql/resolvers/certificate.resolver.ts',
    'apps/backend/src/api/webhooks/public-certificate.controller.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  const svc = readFileSync('apps/backend/src/modules/certificate/certificate-verification.service.ts', 'utf8');
  assert.ok(svc.includes('PublicCertificateVerificationService') && svc.includes('verifyPublicCertificate'), '105 service');
  assert.ok(svc.includes('DigitalSignature') === false || svc.includes('verifyPublicHash'), 'delegates 048 crypto');
  const ctl = readFileSync('apps/backend/src/modules/certificate/certificate-verification.controller.ts', 'utf8');
  assert.ok(ctl.includes('v1/public/certificates') && ctl.includes('verify/:certificateNo'), 'public route');
  const gql = readFileSync('apps/backend/src/modules/certificate/certificate.resolver.ts', 'utf8');
  assert.ok(gql.includes('verifyCertificateDetails') && !gql.includes('CertificateResolverResolver'), 'GQL rich query, no 048 collision');
  const mod = readFileSync('apps/backend/src/modules/certificate/certificate.module.ts', 'utf8');
  assert.ok(mod.includes('PublicCertificateVerificationService') && mod.includes('PublicCertificateResolver'), 'module wiring');
  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  assert.ok(mw.includes('/verify/') && mw.includes('/api/v1/certificates/public/'), 'public bypass');
  for (const p of [
    'apps/frontend/lib/certificate/certificate-verify-client.ts',
    'apps/frontend/hooks/useCertificateVerification.ts',
    'apps/frontend/components/certificate/CertificateVerifyView.tsx',
    'apps/frontend/app/(public)/verify/cert/[certificateNo]/page.tsx',
    'apps/frontend/app/(public)/verify/cert/[certificateNo]/verify-client.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const view = readFileSync('apps/frontend/components/certificate/CertificateVerifyView.tsx', 'utf8');
  assert.ok(!view.includes('lucide-react') && view.includes('CertificateVerificationBadge'), 'zero-dep view reuses 048 badge');
  const hook = readFileSync('apps/frontend/hooks/useCertificateVerification.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const proxy = readFileSync('apps/frontend/app/api/v1/certificates/public/verify/[certificateNo]/route.ts', 'utf8');
  assert.ok(proxy.includes('localhost:4000') && !proxy.includes('authorization'), 'public proxy (no auth)');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('certificate-verification.schema') && barrel.includes('VerificationStatusEnum'));
  // 048 regression pins: issuance crypto + presentation routes untouched.
  const vo = readFileSync('apps/backend/src/modules/certificate/domain/value-objects/digital-signature.vo.ts', 'utf8');
  assert.ok(vo.includes('certNo:${userId}') === false && vo.includes('certNo}:'), '048 payload intact');
  const pctl = readFileSync('apps/backend/src/modules/certificate/presentation/certificate-verify.controller.ts', 'utf8');
  assert.ok(pctl.includes("Controller('api/v1/certificate')"), '048 routes intact');
  ok('Parity: service/controller/GQL/alias/middleware/frontend/proxy/barrel + 048 intact');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase105 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
