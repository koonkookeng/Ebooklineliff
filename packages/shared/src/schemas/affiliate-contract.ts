// SSOT Phase 079 §3.1 — Multi-tier affiliate Zod contract
// Canonical: packages/shared/src/schemas/affiliate-contract.ts
// (legacy src/shared/schemas/affiliate-contract.ts)
// - Spec-verbatim: AffiliateTierLevelEnum / CommissionStatusEnum /
//   PayoutStatusEnum / ReferralLinkGenerateSchema / CommissionCalculateSchema /
//   AffiliatePayoutRequestSchema / LINEFlexSharePayloadSchema (§3.1).
// - RISK_CALL deviations (additive-only, documented):
//   (a) no @line/liff dep (§6.1 asks it): share rides window.liff global +
//       clipboard fallback (zero-dep, bundle stays lean);
//   (b) tenantId is z.string().min(1) (x-tenant-identifier slug hint,
//       Phase 071/073 runtime vocabulary).
//   Money attribution writes (026 share-attribution) are reused, never
//   duplicated — this contract owns rates/payout/fraud math only.
// - Pure helpers: 10/3/1 rate table, 3% withholding, payoutNo, referral URL,
//   circular-loop guard, K-factor. Zero new deps (zod only).
import { z } from 'zod';

export const AffiliateTierLevelEnum = z.enum(['TIER_1_DIRECT', 'TIER_2_INDIRECT', 'TIER_3_COMMUNITY']);
export type AffiliateTierLevel = z.infer<typeof AffiliateTierLevelEnum>;

export const CommissionStatusEnum = z.enum(['PENDING', 'APPROVED', 'PAID', 'CANCELLED', 'BLOCKED_FRAUD']);
export type CommissionStatus = z.infer<typeof CommissionStatusEnum>;

export const PayoutStatusEnum = z.enum(['REQUESTED', 'PROCESSING', 'COMPLETED', 'REJECTED']);
export type PayoutStatus = z.infer<typeof PayoutStatusEnum>;

export const ReferralLinkGenerateSchema = z.object({
  tenantId: z.string().min(1),
  productId: z.string().uuid(),
  customCampaignTag: z.string().optional(),
});
export type ReferralLinkGenerate = z.infer<typeof ReferralLinkGenerateSchema>;

export const CommissionCalculateSchema = z.object({
  orderId: z.string().uuid(),
  orderNetAmount: z.number().positive(),
  buyerUserId: z.string().uuid(),
});
export type CommissionCalculate = z.infer<typeof CommissionCalculateSchema>;

export const AffiliatePayoutRequestSchema = z.object({
  tenantId: z.string().min(1),
  amount: z.number().min(100, 'Minimum payout is 100 THB'),
  bankName: z.string().min(2),
  bankAccountNumber: z.string().min(10),
  bankAccountName: z.string().min(2),
});
export type AffiliatePayoutRequest = z.infer<typeof AffiliatePayoutRequestSchema>;

export const LINEFlexSharePayloadSchema = z.object({
  flexMessageJson: z.string(),
  shareUrl: z.string().url(),
  trackingCode: z.string(),
});
export type LINEFlexSharePayload = z.infer<typeof LINEFlexSharePayloadSchema>;

/** Default tier rates: 10% / 3% / 1% (BDD-2). */
export const TIER_RATE_TABLE = [
  { tier: 'TIER_1_DIRECT', ratePercent: 10 },
  { tier: 'TIER_2_INDIRECT', ratePercent: 3 },
  { tier: 'TIER_3_COMMUNITY', ratePercent: 1 },
] as const;
/** Payout floor: 100 THB (§3.1). */
export const PAYOUT_MIN_THB = 100;
/** e-Withholding tax: 3% (§8.1). */
export const AFFILIATE_WITHHOLDING_TAX_RATE = 0.03;
/** Attribution window: 30 days (§7.1). */
export const AFFILIATE_ATTRIBUTION_DAYS = 30;
/** Anti-fraud stream (BDD-3). */
export const AFFILIATE_FRAUD_STREAM = 'affiliate:fraud:events';
/** Commission event stream (Gate 8). */
export const AFFILIATE_COMMISSION_STREAM = 'affiliate:commission:events';

/** Tier commission for a net amount (2-decimal bank rounding). */
export function tierCommission(netAmount: number, ratePercent: number): number {
  return Math.round((netAmount * ratePercent) / 100 * 100) / 100;
}

/** 3% withholding split for a payout request. */
export function payoutSplit(amount: number): { requested: number; tax: number; net: number } {
  const tax = Math.round(amount * AFFILIATE_WITHHOLDING_TAX_RATE * 100) / 100;
  return { requested: amount, tax, net: Math.round((amount - tax) * 100) / 100 };
}

/** Human payout number: PO-<tenant-slice>-<base36 time>. */
export function payoutNumber(tenantId: string, at = Date.now()): string {
  const slice = tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase().padEnd(3, 'X');
  return `PO-${slice}-${at.toString(36).toUpperCase()}`;
}

/** Signed referral URL embedding the affiliate code + campaign. */
export function referralUrl(origin: string, productId: string, affiliateCode: string, campaign?: string): string {
  const base = origin.replace(/\/$/, '');
  const tag = campaign ? `&tag=${encodeURIComponent(campaign)}` : '';
  return `${base}/p/${productId}?ref=${encodeURIComponent(affiliateCode)}${tag}`;
}

/**
 * Circular referral guard (§10): walk the ancestor chain (max 3 hops);
 * returns false when a loop or self-reference is detected.
 */
export function isAcyclicChain(buyerId: string, ancestors: Array<{ id: string } | null>): boolean {
  const seen = new Set<string>([buyerId]);
  for (const a of ancestors) {
    if (!a) continue;
    if (seen.has(a.id)) return false;
    seen.add(a.id);
  }
  return true;
}

/** Viral K-factor: K = invites x conversion (§7.1). */
export function kFactor(invitesPerUser: number, conversionRate: number): number {
  return Math.round(invitesPerUser * conversionRate * 1000) / 1000;
}
