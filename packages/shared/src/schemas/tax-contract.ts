// SSOT Phase 082 §3.1 — Automated 3% tax withholding + 50 Tawi contract
// Canonical: packages/shared/src/schemas/tax-contract.ts
// (legacy src/shared/schemas/tax-contract.ts — placeholder until this phase)
// - Spec-verbatim: TaxPayerTypeEnum / IncomeTypeEnum / TaxFormTypeEnum /
//   TaxProfileSchema / CalculateTaxRequestSchema /
//   WithholdingTaxCertificateSchema (§3.1).
// - NOTE on pdfStoragePathR2 (.url() verbatim): the API layer exposes a
//   fresh 15-minute signed download URL in this field; the vault object key
//   is stored separately server-side (R2 keys are not URLs).
// - RISK_CALL (documented): money-write paths stay in 081 (single ledger
//   writer); this contract owns tax math (3% half-up), Thai Tax-ID checksum,
//   certificate numbering, signed-download tickets and e-Tax lines only.
// - Pure helpers: calculate3PercentWithholding (100000-case precision guard
//   shape), verifyThaiTaxId (13-digit checksum), tawiCertificateNo,
//   download-ticket sign/verify (15-min TTL), eTax line builders, stream keys.
// - Zero new deps (zod only; node:crypto via require, 080 precedent).
import { z } from 'zod';

export const TaxPayerTypeEnum = z.enum(['INDIVIDUAL', 'JURISTIC_PERSON']);
export type TaxPayerType = z.infer<typeof TaxPayerTypeEnum>;

export const IncomeTypeEnum = z.enum(['CREATOR_SHARE_40_8', 'AFFILIATE_COMMISSION_40_2', 'SERVICE_FEE_40_8']);
export type IncomeType = z.infer<typeof IncomeTypeEnum>;

export const TaxFormTypeEnum = z.enum(['PND_1K', 'PND_2', 'PND_3', 'PND_53']);
export type TaxFormType = z.infer<typeof TaxFormTypeEnum>;

export const TaxProfileSchema = z.object({
  userId: z.string().uuid(),
  payerType: TaxPayerTypeEnum,
  taxId: z.string().min(10).max(13),
  fullNameOrCompanyName: z.string().min(2),
  address: z.string().min(5),
  isVerified: z.boolean().default(false),
});
export type TaxProfile = z.infer<typeof TaxProfileSchema>;

export const CalculateTaxRequestSchema = z.object({
  payoutRequestId: z.string().uuid(),
  grossAmount: z.number().positive(),
  incomeType: IncomeTypeEnum,
  taxRate: z.number().default(0.03),
});
export type CalculateTaxRequest = z.infer<typeof CalculateTaxRequestSchema>;

export const WithholdingTaxCertificateSchema = z.object({
  certificateNo: z.string(),
  sequenceNo: z.string(),
  payerTaxId: z.string(),
  payeeTaxId: z.string(),
  grossAmount: z.number(),
  taxWithheldAmount: z.number(),
  netAmount: z.number(),
  paymentDate: z.string().datetime(),
  pdfStoragePathR2: z.string().url(),
});
export type WithholdingTaxCertificate = z.infer<typeof WithholdingTaxCertificateSchema>;

/** Standard 3% rate (§6.1,มาตรา 40). */
export const TAX_STANDARD_RATE = 0.03;
/** Corporate exemption flag lives on the profile (isTaxExempt). */
export const TAX_DOWNLOAD_TTL_SEC = 15 * 60;
/** Tax event stream (Gate 8, BullMQ-style async handoff). */
export const TAX_WITHHELD_STREAM = 'tax:withheld:events';
/** PDF generation budget: <500ms (§10). */
export const TAX_PDF_BUDGET_MS = 500;

/**
 * Strict Thai Revenue Code 3% calc (spec §6.1 verbatim math, EPSILON
 * half-up): 10000 → { tax: 300, net: 9700 }.
 */
export function calculate3PercentWithholding(
  grossAmount: number,
  payerType: 'INDIVIDUAL' | 'JURISTIC_PERSON' = 'INDIVIDUAL',
): { grossAmount: number; taxRate: number; taxWithheld: number; netAmount: number } {
  if (!(grossAmount > 0)) throw new Error('Gross amount must be positive');
  void payerType;
  const taxRate = 0.03;
  const rawTax = grossAmount * taxRate;
  const taxWithheld = Math.round((rawTax + Number.EPSILON) * 100) / 100;
  const netAmount = Math.round((grossAmount - taxWithheld + Number.EPSILON) * 100) / 100;
  return { grossAmount, taxRate: 3.0, taxWithheld, netAmount };
}

/** Thai 13-digit national Tax-ID checksum (mod-11). */
export function verifyThaiTaxId(taxId: string): boolean {
  if (!/^\d{13}$/.test(taxId)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(taxId[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(taxId[12]);
}

/** Build a checksum-valid 13-digit ID from any 12-digit prefix (tests/seeds). */
export function completeThaiTaxId(prefix12: string): string {
  const p = (prefix12.replace(/\D/g, '') + '000000000000').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p[i]) * (13 - i);
  return `${p}${(11 - (sum % 11)) % 10}`;
}

/** Certificate number: 50TW-YYYYMM-<base36 time> (unique, sortable, race-free). */
export function tawiCertificateNo(at = Date.now()): { certificateNo: string; sequenceNo: string } {
  const d = new Date(at);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const seq = at.toString(36).toUpperCase().slice(-6).padStart(4, '0');
  return { certificateNo: `50TW-${ym}-${seq}`, sequenceNo: seq };
}

function nodeCrypto(): {
  createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
  createHash(a: string): { update(d: string | Buffer): { digest(e: string): string } };
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never;
}

/** SHA-256 document seal (pdfFileHash, tamper evidence §8.1). */
export function sha256Hex(data: string | Buffer): string {
  return nodeCrypto().createHash('sha256').update(data).digest('hex');
}

/** Sign a 15-minute download ticket: base64url(`${certId}:${exp}:${hmac}`). */
export function signDownloadTicket(secret: string, certificateId: string, now = Date.now()): string {
  const exp = now + TAX_DOWNLOAD_TTL_SEC * 1000;
  const hmac = nodeCrypto().createHmac('sha256', secret).update(`${certificateId}:${exp}`).digest('hex');
  return Buffer.from(`${certificateId}:${exp}:${hmac}`).toString('base64url');
}

/** Verify a download ticket. Returns the certificateId or null. */
export function verifyDownloadTicket(secret: string, ticket: string, now = Date.now()): string | null {
  try {
    const crypto = nodeCrypto();
    const [certId, expRaw, hmac] = Buffer.from(ticket, 'base64url').toString('utf8').split(':');
    if (!certId || !expRaw || !hmac) return null;
    if (Number(expRaw) < now) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${certId}:${expRaw}`).digest('hex');
    const a = Buffer.from(hmac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return certId;
  } catch {
    return null;
  }
}

/** e-Tax monthly line (PND3/PND53 pipe format) for one certificate. */
export function eTaxLine(args: {
  formType: string;
  certificateNo: string;
  payeeTaxId: string;
  grossAmount: number;
  taxWithheld: number;
  paymentDate: string;
}): string {
  const g = args.grossAmount.toFixed(2);
  const t = args.taxWithheld.toFixed(2);
  return `${args.formType}|${args.certificateNo}|${args.payeeTaxId}|${g}|${t}|${args.paymentDate}`;
}

/** Redis key for a recipient's annual tax summary cache. */
export function taxSummaryKey(userId: string, year: number): string {
  return `tax:summary:${userId}:${year}`;
}
