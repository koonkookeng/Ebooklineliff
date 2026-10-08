// SSOT Phase 082 Task 4 — 50 Tawi certificate field model (dep-free)
// Canonical: apps/backend/src/modules/tax/infrastructure/pdf-generator/templates/50-tawi-template.tsx
// (kept .tsx per the §5.1 tree; content is plain TS — no JSX runtime so the
// LIFF bundle and the worker stay lean. Dep-free by Gate 5 design.)
// - Builds the official-layout field list for หนังสือรับรองการหักภาษี ณ ที่จ่าย
//   (มาตรา 50 ทวิ): payer/payee blocks, income rows, seal + verify payload.
// - Zero new deps.
export interface TawiPayerBlock {
  taxId: string;
  name: string;
  address: string;
}

export interface TawiPayeeBlock {
  taxId: string;
  name: string;
  address: string;
  payerType: 'INDIVIDUAL' | 'JURISTIC_PERSON';
}

export interface TawiCertificateFields {
  certificateNo: string;
  sequenceNo: string;
  formType: string;
  incomeType: string;
  payer: TawiPayerBlock;
  payee: TawiPayeeBlock;
  grossAmount: number;
  taxRate: number;
  taxWithheld: number;
  netAmount: number;
  paymentDate: string;
  sealHash: string;
  verifyPayload: string;
}

export function tawiVerifyPayload(certificateNo: string, sealHash: string): string {
  return `TAWI:${certificateNo}:${sealHash.slice(0, 16)}`;
}

export function buildTawiFields(args: {
  certificateNo: string;
  sequenceNo: string;
  formType: string;
  incomeType: string;
  payer: TawiPayerBlock;
  payee: TawiPayeeBlock;
  grossAmount: number;
  taxRate: number;
  taxWithheld: number;
  netAmount: number;
  paymentDate: string;
  sealHash: string;
}): TawiCertificateFields {
  const verifyPayload = tawiVerifyPayload(args.certificateNo, args.sealHash);
  return { ...args, verifyPayload };
}

/** A4 layout budget: single page, Helvetica core font (no font embedding). */
export const TAWI_PAGE = { width: 595, height: 842, margin: 56, fontSize: 11, lineHeight: 14 } as const;
