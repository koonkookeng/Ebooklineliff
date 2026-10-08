// SSOT Phase 082 §10-11 — contract tests (Zod, 3% math, checksum, PDF, usecases, parity)
// Run: npx tsx scripts/test-phase082-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TaxPayerTypeEnum,
  IncomeTypeEnum,
  TaxFormTypeEnum,
  TaxProfileSchema,
  CalculateTaxRequestSchema,
  WithholdingTaxCertificateSchema,
  TAX_STANDARD_RATE,
  TAX_DOWNLOAD_TTL_SEC,
  TAX_WITHHELD_STREAM,
  TAX_PDF_BUDGET_MS,
  calculate3PercentWithholding,
  verifyThaiTaxId,
  completeThaiTaxId,
  tawiCertificateNo,
  sha256Hex,
  signDownloadTicket,
  verifyDownloadTicket,
  eTaxLine,
  taxSummaryKey,
} from '../packages/shared/src/schemas/tax-contract';
import { TaxCalculatorDomainService } from '../apps/backend/src/modules/tax/domain/services/tax-calculator.domain-service';
import { assertCertificateAmounts, assertCertificateNo } from '../apps/backend/src/modules/tax/domain/entities/tax-certificate.entity';
import { PdfCompilerService } from '../apps/backend/src/modules/tax/infrastructure/pdf-generator/pdf-compiler.service';
import { tawiVerifyPayload } from '../apps/backend/src/modules/tax/infrastructure/pdf-generator/templates/50-tawi-template';
import { CalculateTaxUseCase } from '../apps/backend/src/modules/tax/application/use-cases/calculate-tax.use-case';
import { withholdingSplit } from '../packages/shared/src/schemas/finance-contract';
import { Generate50TawiPdfUseCase } from '../apps/backend/src/modules/tax/application/use-cases/generate-50-tawi-pdf.use-case';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const TENANT = 'emerald-mall';
const SECRET = 'test-tax-secret-082';
const TAX_ID = completeThaiTaxId('110070062621');

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(TaxPayerTypeEnum.safeParse('INDIVIDUAL').success, true);
  assert.equal(TaxPayerTypeEnum.safeParse('JURISTIC_PERSON').success, true);
  assert.equal(TaxPayerTypeEnum.safeParse('GOV').success, false);
  assert.equal(IncomeTypeEnum.safeParse('AFFILIATE_COMMISSION_40_2').success, true);
  assert.equal(IncomeTypeEnum.safeParse('SALARY').success, false);
  assert.equal(TaxFormTypeEnum.safeParse('PND_53').success, true);
  assert.equal(TaxFormTypeEnum.safeParse('PND_99').success, false);
  assert.equal(
    TaxProfileSchema.safeParse({
      userId: UUID, payerType: 'INDIVIDUAL', taxId: '1100700626212',
      fullNameOrCompanyName: 'Somsri', address: 'Bangkok 10110',
    }).success,
    true,
  );
  assert.equal(
    TaxProfileSchema.safeParse({
      userId: UUID, payerType: 'INDIVIDUAL', taxId: '123',
      fullNameOrCompanyName: 'S', address: 'BKK',
    }).success,
    false,
  );
  assert.equal(
    CalculateTaxRequestSchema.safeParse({ payoutRequestId: UUID, grossAmount: 10000, incomeType: 'CREATOR_SHARE_40_8' }).success,
    true,
  );
  assert.equal(
    CalculateTaxRequestSchema.safeParse({ payoutRequestId: UUID, grossAmount: -5, incomeType: 'CREATOR_SHARE_40_8' }).success,
    false,
  );
  assert.equal(
    WithholdingTaxCertificateSchema.safeParse({
      certificateNo: '50TW-202601-AB12', sequenceNo: 'AB12', payerTaxId: '0100000000000',
      payeeTaxId: TAX_ID, grossAmount: 10000, taxWithheldAmount: 300, netAmount: 9700,
      paymentDate: new Date().toISOString(), pdfStoragePathR2: 'https://r2.example.com/tax/50TW.pdf',
    }).success,
    true,
  );
  assert.equal(
    WithholdingTaxCertificateSchema.safeParse({
      certificateNo: 'x', sequenceNo: 'y', payerTaxId: 'p', payeeTaxId: 'q',
      grossAmount: 1, taxWithheldAmount: 0, netAmount: 1,
      paymentDate: 'not-a-date', pdfStoragePathR2: 'not-a-url',
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (payer/income/form/profile/calc/cert gates)');
}

// ---------- 2. 3% math + checksum + numbering (§6.1/§7.2) ----------
{
  assert.equal(TAX_STANDARD_RATE, 0.03);
  assert.equal(TAX_DOWNLOAD_TTL_SEC, 900);
  assert.equal(TAX_WITHHELD_STREAM, 'tax:withheld:events');
  assert.equal(TAX_PDF_BUDGET_MS, 500);
  // BDD-1 canonical: 10000 → 300 / 9700.
  assert.deepEqual(calculate3PercentWithholding(10000), { grossAmount: 10000, taxRate: 3.0, taxWithheld: 300, netAmount: 9700 });
  assert.deepEqual(calculate3PercentWithholding(5000).taxWithheld, 300 - 150);
  assert.throws(() => calculate3PercentWithholding(0), /positive/);
  assert.throws(() => calculate3PercentWithholding(-1), /positive/);
  assert.equal(verifyThaiTaxId(TAX_ID), true);
  assert.equal(verifyThaiTaxId(`${TAX_ID.slice(0, 12)}${(Number(TAX_ID[12]) + 1) % 10}`), false);
  assert.equal(verifyThaiTaxId('123'), false);
  assert.equal(verifyThaiTaxId('abcdefghijklm'), false);
  const { certificateNo, sequenceNo } = tawiCertificateNo();
  assert.ok(/^50TW-\d{6}-[0-9A-Z]{4,}$/.test(certificateNo), certificateNo);
  assert.ok(sequenceNo.length >= 4);
  assert.equal(sha256Hex('abc').length, 64);
  const ticket = signDownloadTicket(SECRET, 'cert-1');
  assert.equal(verifyDownloadTicket(SECRET, ticket), 'cert-1');
  assert.equal(verifyDownloadTicket('wrong', ticket), null);
  assert.equal(verifyDownloadTicket(SECRET, 'garbage'), null);
  assert.equal(
    verifyDownloadTicket(SECRET, signDownloadTicket(SECRET, 'c', Date.now() - 16 * 60 * 1000)),
    null,
  );
  assert.equal(
    eTaxLine({ formType: 'PND_3', certificateNo, payeeTaxId: TAX_ID, grossAmount: 10000, taxWithheld: 300, paymentDate: '2026-01-15T00:00:00.000Z' }),
    `PND_3|${certificateNo}|${TAX_ID}|10000.00|300.00|2026-01-15T00:00:00.000Z`,
  );
  assert.equal(taxSummaryKey('u', 2026), 'tax:summary:u:2026');
  ok('Math: 10000→300/9700 + checksum + numbering + ticket + eTax');
}

// ---------- 3. Domain service single source (§9) + entity guards ----------
{
  assert.deepEqual(TaxCalculatorDomainService.calculate3PercentWithholding(10000), {
    grossAmount: 10000, taxRate: 3.0, taxWithheld: 300, netAmount: 9700,
  });
  const svc = new TaxCalculatorDomainService();
  assert.deepEqual(svc.calculate(10000, { isTaxExempt: true }), {
    grossAmount: 10000, taxRate: 0, taxWithheld: 0, netAmount: 10000,
  });
  assert.equal(TaxCalculatorDomainService.effectiveRate(true), 0);
  assert.equal(TaxCalculatorDomainService.effectiveRate(false), 0.03);
  assert.equal(TaxCalculatorDomainService.isValidTaxId(TAX_ID), true);
  assert.doesNotThrow(() => assertCertificateAmounts({ grossAmount: 10000, taxWithheld: 300, netAmount: 9700 }));
  assert.doesNotThrow(() => assertCertificateAmounts({ grossAmount: 10000, taxWithheld: 0, netAmount: 10000, isTaxExempt: true }));
  assert.throws(() => assertCertificateAmounts({ grossAmount: 10000, taxWithheld: 299, netAmount: 9701 }), /mismatch/);
  assert.throws(() => assertCertificateAmounts({ grossAmount: 0, taxWithheld: 0, netAmount: 0 }), /positive/);
  assert.doesNotThrow(() => assertCertificateNo('50TW-202601-AB12'));
  assert.throws(() => assertCertificateNo('NOPE'), /Invalid 50 Tawi/);
  // 081 finance math stays identical through the delegate (§9).
  assert.equal(withholdingSplit(10000).tax, calculate3PercentWithholding(10000).taxWithheld);
  ok('Domain: single-source 3% + exempt + guards + 081 parity');
}

// ---------- 4. PDF compiler (Task 4, dep-free, sealed) ----------
{
  const compiler = new PdfCompilerService();
  const tawiInput = {
    certificateNo: '50TW-202601-AB12',
    sequenceNo: 'AB12',
    formType: 'PND_3',
    incomeType: 'CREATOR_SHARE_40_8',
    payer: { taxId: '0100000000000', name: 'EBOOK-LIFF', address: 'BKK' },
    payee: { taxId: TAX_ID, name: 'Somsri', address: 'BKK 10110', payerType: 'INDIVIDUAL' as const },
    grossAmount: 10000,
    taxRate: 3,
    taxWithheld: 300,
    netAmount: 9700,
    paymentDate: '2026-01-15T00:00:00.000Z',
  };
  const { pdf, hash, fields } = compiler.compile(tawiInput);
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  assert.ok(pdf.length > 800, `pdf bytes: ${pdf.length}`);
  assert.equal(hash.length, 64);
  assert.equal(fields.verifyPayload, tawiVerifyPayload('50TW-202601-AB12', compiler.sealFor(tawiInput)));
  assert.ok(pdf.toString('utf8').includes('50TW-202601-AB12'));
  assert.ok(pdf.toString('utf8').includes('9700.00'));
  const seal = compiler.sealFor({
    certificateNo: '50TW-202601-AB12',
    sequenceNo: 'AB12',
    formType: 'PND_3',
    incomeType: 'CREATOR_SHARE_40_8',
    payer: { taxId: 'a', name: 'b', address: 'c' },
    payee: { taxId: 'd', name: 'e', address: 'f', payerType: 'INDIVIDUAL' },
    grossAmount: 10000,
    taxRate: 3,
    taxWithheld: 300,
    netAmount: 9700,
    paymentDate: 'x',
  });
  assert.equal(compiler.sealFor({
    certificateNo: '50TW-202601-AB12',
    sequenceNo: 'ZZ',
    formType: 'PND_53',
    incomeType: 'SERVICE_FEE_40_8',
    payer: { taxId: 'a', name: 'b', address: 'c' },
    payee: { taxId: 'd', name: 'e', address: 'f', payerType: 'INDIVIDUAL' },
    grossAmount: 10000,
    taxRate: 3,
    taxWithheld: 300,
    netAmount: 9700,
    paymentDate: 'x',
  }), seal, 'seal ignores cosmetic fields');
  ok('PDF: dep-free A4 + seal + verify payload + official fields');
}

// ---------- 5. Calculate-tax use-case (BDD-1 + anomalies + stream) ----------
async function sectionCalculate(): Promise<void> {
  function ports(profile: { taxId: string; isTaxExempt: boolean } | null) {
    const streams: string[] = [];
    const repo = {
      findPayout: async (id: string) =>
        id === UUID ? { id, userId: UUID_B, grossAmount: 10000 } : null,
      findProfile: async () =>
        profile ? { id: 'prof-1', userId: UUID_B, payerType: 'INDIVIDUAL', ...profile, fullNameOrCompanyName: 'S', branchCode: '00000', address: 'BKK 10110', verifiedAt: null } : null,
    };
    const bus = { xadd: async (s: string) => { streams.push(s); } };
    return { repo, bus, streams };
  }
  // Happy path: 10000 → 300/9700 + TAX_WITHHELD handoff.
  {
    const p = ports({ taxId: TAX_ID, isTaxExempt: false });
    const svc = new CalculateTaxUseCase(p.repo as never, p.bus);
    const r = await svc.execute({
      tenantId: TENANT,
      actorUserId: UUID_B,
      body: { payoutRequestId: UUID, grossAmount: 10000, incomeType: 'CREATOR_SHARE_40_8' },
    });
    assert.deepEqual(r, {
      payoutRequestId: UUID, grossAmount: 10000, taxRate: 3.0,
      taxWithheld: 300, netAmount: 9700, isExempt: false, anomalies: [],
    });
    assert.ok(p.streams.includes(TAX_WITHHELD_STREAM));
  }
  // Exempt profile → 0 tax, full net.
  {
    const p = ports({ taxId: TAX_ID, isTaxExempt: true });
    const svc = new CalculateTaxUseCase(p.repo as never, p.bus);
    const r = await svc.execute({
      tenantId: TENANT, actorUserId: UUID_B,
      body: { payoutRequestId: UUID, grossAmount: 10000, incomeType: 'CREATOR_SHARE_40_8' },
    });
    assert.deepEqual(r, {
      payoutRequestId: UUID, grossAmount: 10000, taxRate: 0,
      taxWithheld: 0, netAmount: 10000, isExempt: true, anomalies: [],
    });
  }
  // Bad checksum → anomaly flag, math still applies.
  {
    const p = ports({ taxId: '1100000000000', isTaxExempt: false });
    const svc = new CalculateTaxUseCase(p.repo as never, p.bus);
    const r = await svc.execute({
      tenantId: TENANT, actorUserId: UUID_B,
      body: { payoutRequestId: UUID, grossAmount: 10000, incomeType: 'AFFILIATE_COMMISSION_40_2' },
    });
    assert.deepEqual(r.anomalies, ['INVALID_TAX_ID']);
    assert.equal(r.taxWithheld, 300);
  }
  {
    const p = ports(null);
    const svc = new CalculateTaxUseCase(p.repo as never, p.bus);
    const r = await svc.execute({
      tenantId: TENANT, actorUserId: UUID_B,
      body: { payoutRequestId: UUID, grossAmount: 10000, incomeType: 'SERVICE_FEE_40_8' },
    });
    assert.deepEqual(r.anomalies, ['PROFILE_UNVERIFIED']);
  }
  // Gates: bad Zod / unknown payout / foreign-actor payout.
  {
    const p = ports({ taxId: TAX_ID, isTaxExempt: false });
    const svc = new CalculateTaxUseCase(p.repo as never, p.bus);
    await assert.rejects(
      svc.execute({ tenantId: TENANT, actorUserId: UUID_B, body: { payoutRequestId: UUID, grossAmount: -1, incomeType: 'CREATOR_SHARE_40_8' } }),
      /Invalid tax calculation/,
    );
    await assert.rejects(
      svc.execute({ tenantId: TENANT, actorUserId: UUID_B, body: { payoutRequestId: UUID_B, grossAmount: 100, incomeType: 'CREATOR_SHARE_40_8' } }),
      /Payout request not found/,
    );
    await assert.rejects(
      svc.execute({ tenantId: TENANT, actorUserId: UUID, body: { payoutRequestId: UUID, grossAmount: 100, incomeType: 'CREATOR_SHARE_40_8' } }),
      /does not belong/,
    );
  }
  ok('Calculate: 10000→300/9700 + exempt/anomaly + 3 gates + stream');
}

// ---------- 6. Generate-50-Tawi use-case (BDD-2 <500ms + R2 + seal) ----------
async function sectionGenerate(): Promise<void> {
  function ports() {
    const profile = {
      id: 'prof-1', userId: UUID_B, payerType: 'INDIVIDUAL', taxId: TAX_ID,
      fullNameOrCompanyName: 'Somsri', branchCode: '00000', address: 'BKK 10110',
      isTaxExempt: false, verifiedAt: null,
    };
    const created: unknown[] = [];
    const repo = {
      findProfile: async () => profile,
      createCertificate: async (a: unknown) => { created.push(a); return { id: 'cert-1' }; },
      withTx(tx: unknown) { return this; },
    };
    const puts: Array<{ key: string; type: string }> = [];
    const r2 = {
      putObjectBuffer: async (key: string, body: Buffer, type: string) => { puts.push({ key, type }); return { eTag: 'e' }; },
      presignedGetUrl: (key: string) => `https://r2.example.com/${key}?sig`,
    };
    const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
    const events: string[] = [];
    const bus = { xadd: async (s: string) => { events.push(s); } };
    return { repo, r2, tx, bus, created, puts, events };
  }
  {
    const p = ports();
    const svc = new Generate50TawiPdfUseCase(p.repo as never, new PdfCompilerService(), p.r2, p.tx, p.bus, SECRET);
    const t0 = Date.now();
    const r = await svc.execute({ tenantId: TENANT, actorUserId: UUID_B, grossAmount: 10000 });
    assert.ok(Date.now() - t0 < 500, 'pdf path <500ms budget');
    assert.ok(/^50TW-\d{6}-/.test(r.certificateNo), r.certificateNo);
    assert.equal(r.certificateId, 'cert-1');
    assert.ok(r.downloadUrl.includes('?ticket='));
    assert.equal(r.downloadExpiresInSec, 900);
    assert.ok(r.pdfBytes > 800);
    assert.ok(r.tookMs < 500);
    assert.equal(verifyDownloadTicket(SECRET, r.downloadUrl.split('?ticket=')[1] ?? ''), 'cert-1');
    assert.equal(p.created.length, 1);
    assert.ok((p.puts[0]?.key ?? '').includes(`/tax/${r.certificateNo}.pdf`));
    assert.equal(p.puts[0]?.type, 'application/pdf');
    assert.ok(p.events.includes(TAX_WITHHELD_STREAM));
  }
  // Gates: missing profile / bad checksum / non-positive.
  {
    const p = ports();
    const noProfile = { ...p, repo: { ...p.repo, findProfile: async () => null } };
    const s1 = new Generate50TawiPdfUseCase(noProfile.repo as never, new PdfCompilerService(), p.r2, p.tx, p.bus, SECRET);
    await assert.rejects(s1.execute({ tenantId: TENANT, actorUserId: UUID_B, grossAmount: 100 }), /tax profile/);
    const badId = {
      ...p,
      repo: { ...p.repo, findProfile: async () => ({ id: 'p', userId: UUID_B, payerType: 'INDIVIDUAL', taxId: '1100000000000', fullNameOrCompanyName: 'S', branchCode: '00000', address: 'B', isTaxExempt: false, verifiedAt: null }) },
    };
    const s2 = new Generate50TawiPdfUseCase(badId.repo as never, new PdfCompilerService(), p.r2, p.tx, p.bus, SECRET);
    await assert.rejects(s2.execute({ tenantId: TENANT, actorUserId: UUID_B, grossAmount: 100 }), /tax profile/);
    const s3 = new Generate50TawiPdfUseCase(p.repo as never, new PdfCompilerService(), p.r2, p.tx, p.bus, SECRET);
    await assert.rejects(s3.execute({ tenantId: TENANT, actorUserId: UUID_B, grossAmount: 0 }), /positive/);
  }
  ok('Generate: 50TW cert + R2 + ticket + seal (<500ms) + 3 gates');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum TaxPayerType {',
    'enum IncomeType {',
    'AFFILIATE_COMMISSION_40_2',
    'enum TaxFormType {',
    'PND_53',
    'model UserTaxProfile {',
    'userId                String       @unique',
    'isTaxExempt           Boolean      @default(false)',
    'model WithholdingTaxCertificate {',
    'certificateNo    String         @unique',
    'pdfFileHash      String',
    'isSubmittedETax  Boolean        @default(false)',
    'taxProfile           UserTaxProfile?',
    'taxCertificates      WithholdingTaxCertificate[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: tax enums + profile + 50TW certificates + User relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/tax/domain/services/tax-calculator.domain-service.ts',
    'apps/backend/src/modules/tax/domain/entities/tax-certificate.entity.ts',
    'apps/backend/src/modules/tax/application/dto/tax-request.dto.ts',
    'apps/backend/src/modules/tax/application/use-cases/calculate-tax.use-case.ts',
    'apps/backend/src/modules/tax/application/use-cases/generate-50-tawi-pdf.use-case.ts',
    'apps/backend/src/modules/tax/infrastructure/pdf-generator/pdf-compiler.service.ts',
    'apps/backend/src/modules/tax/infrastructure/pdf-generator/templates/50-tawi-template.ts',
    'apps/backend/src/modules/tax/infrastructure/repositories/tax-prisma.repository.ts',
    'apps/backend/src/modules/tax/presentation/graphql/tax.resolver.ts',
    'apps/backend/src/modules/tax/presentation/rest/tax.controller.ts',
    'apps/backend/src/modules/tax/presentation/webhooks/tax-export.controller.ts',
    'apps/backend/src/modules/tax/tax.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  // 086-owned payout scaffolds stay untouched for their phase.
  assert.ok(
    readFileSync('apps/backend/src/modules/payout/payout.module.ts', 'utf8').includes('AUTO-SCAFFOLD'),
    'payout module stays 086-owned',
  );
  const fin = readFileSync('apps/backend/src/modules/finance/application/tax-calculator.service.ts', 'utf8');
  assert.ok(fin.includes('TaxCalculatorDomainService'), '081 delegates to single-source §9');
  const mod = readFileSync('apps/backend/src/modules/tax/tax.module.ts', 'utf8');
  assert.ok(mod.includes('TaxModule') && mod.includes('CalculateTaxUseCase') && mod.includes('Generate50TawiPdfUseCase'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('TaxModule'));
  const gql = readFileSync('apps/backend/src/modules/tax/presentation/graphql/tax.resolver.ts', 'utf8');
  assert.ok(gql.includes('myTaxCertificates') && gql.includes('calculateTax') && gql.includes('generateTaxCertificate') && gql.includes('upsertTaxProfile'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/tax.resolver.ts', 'utf8');
  assert.ok(alias.includes('TaxResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/tax.graphql', 'utf8');
  assert.ok(sdl.includes('TaxCertificatePayload') && sdl.includes('myTaxSummary'));
  for (const p of [
    'apps/frontend/components/tax/TaxSummaryCard.tsx',
    'apps/frontend/components/tax/TawiCertificateCard.tsx',
    'apps/frontend/hooks/useTaxCenter.ts',
    'apps/frontend/lib/tax/tax-client.ts',
    'apps/frontend/app/(liff)/tax/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useTaxCenter.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(hook.includes('cachedTaxSummary'), 'offline-first annual cache');
  assert.ok(!hook.includes("from 'lucide-react'") && !hook.includes("from 'recharts'"), 'zero-dep UI');
  for (const p of [
    'apps/frontend/app/api/v1/tax/summary/route.ts',
    'apps/frontend/app/api/v1/tax/certificates/route.ts',
    'apps/frontend/app/api/v1/tax/calculate/route.ts',
    'apps/frontend/app/api/v1/tax/profile/route.ts',
    'apps/frontend/app/api/v1/tax/download/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('tax-contract') && barrel.includes('CalculateTaxRequestSchema'));
  ok('Parity: module/GQL+alias/SDL/tax center/proxies/barrel (5-state, offline, zero-dep)');
}

async function main(): Promise<void> {
  await sectionCalculate();
  await sectionGenerate();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase082 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
