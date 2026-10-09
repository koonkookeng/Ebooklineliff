// SSOT Phase 086 §3.1 — Payout clearing contract (bank settlement completion)
// Canonical: packages/shared/src/schemas/payout-clearing.schema.ts
// (legacy src/shared/schemas/payout-clearing.schema.ts — did not exist)
// - Spec-verbatim: PayoutRequestPayloadSchema / PayoutCalculationSchema /
//   BankPayoutCallbackSchema (§3.1).
// - RISK_CALL deviations (additive-only, documented — anti-duplication):
//   (a) NO new PayoutStatusEnum: FinancePayoutStatusEnum (081) is extended
//       with PENDING_APPROVAL + FAILED_BANK_TRANSFER (backward compatible);
//   (b) NO PayoutRequest table: PayoutTransaction is the canonical payout
//       record (073+081 union); REQUESTED ≡ PENDING_APPROVAL at creation;
//   (c) NO new tax math: withholding delegates to finance-contract §8.2;
//   (d) NO new payout math: payout-calculator delegates to the same split.
// - Pure helpers: clearing batch numbers, bank-payload HMAC sign/verify,
//   hold/audit keys, clearing stream. Zero new deps (zod only).
import { z } from 'zod';

export const PayoutRequestPayloadSchema = z.object({
  tenantId: z.string().min(1),
  amount: z.number().min(100.0, { message: 'ขั้นต่ำในการถอนคือ 100 บาท' }),
  bankAccountId: z.string().uuid(),
  remark: z.string().optional(),
});
export type PayoutRequestPayload = z.infer<typeof PayoutRequestPayloadSchema>;

export const PayoutCalculationSchema = z.object({
  grossAmount: z.number().positive(),
  taxWithheldAmount: z.number().min(0),
  feeAmount: z.number().min(0),
  netPayableAmount: z.number().positive(),
});
export type PayoutCalculation = z.infer<typeof PayoutCalculationSchema>;

export const BankPayoutCallbackSchema = z.object({
  payoutId: z.string().uuid(),
  transRef: z.string(),
  statusCode: z.string(),
  transferredAt: z.string().datetime(),
  failureReason: z.string().optional(),
});
export type BankPayoutCallback = z.infer<typeof BankPayoutCallbackSchema>;

/** Bank batch dispatch states (transport-level, not ledger statuses). */
export const BankDispatchStatusEnum = z.enum(['STAGED', 'DISPATCHED', 'ACKED', 'FAILED']);
export type BankDispatchStatus = z.infer<typeof BankDispatchStatusEnum>;

/** Clearing batch number: CLR-<tenant-slice>-<base36 time>. */
export function clearingBatchNo(tenantId: string, at = Date.now()): string {
  const slice = tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase().padEnd(3, 'X');
  return `CLR-${slice}-${at.toString(36).toUpperCase()}`;
}

function nodeCrypto(): {
  createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never;
}

/** Sign an encrypted bank payload envelope: base64url(`${payoutId}:${transRef}:${exp}:${hmac}`). */
export function signBankPayload(secret: string, args: { payoutId: string; transRef: string }, now = Date.now()): string {
  const exp = now + 24 * 60 * 60 * 1000;
  const hmac = nodeCrypto().createHmac('sha256', secret).update(`${args.payoutId}:${args.transRef}:${exp}`).digest('hex');
  return Buffer.from(`${args.payoutId}:${args.transRef}:${exp}:${hmac}`).toString('base64url');
}

/** Verify a bank callback envelope. Returns { payoutId, transRef } or null. */
export function verifyBankPayload(secret: string, envelope: string, now = Date.now()): { payoutId: string; transRef: string } | null {
  try {
    const crypto = nodeCrypto();
    const [payoutId, transRef, expRaw, hmac] = Buffer.from(envelope, 'base64url').toString('utf8').split(':');
    if (!payoutId || !transRef || !expRaw || !hmac) return null;
    if (Number(expRaw) < now) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${payoutId}:${transRef}:${expRaw}`).digest('hex');
    const a = Buffer.from(hmac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { payoutId, transRef };
  } catch {
    return null;
  }
}

/** Clearing event stream (Gate 8). */
export const PAYOUT_CLEARING_STREAM = 'finance:clearing:events';

/** Redis wallet-hold key (double-spend guard, §8.2 row-lock companion). */
export function payoutHoldKey(userId: string, payoutId: string): string {
  return `payout:hold:${userId}:${payoutId}`;
}
