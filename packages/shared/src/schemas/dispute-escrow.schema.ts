// SSOT Phase 113 §3.1 — escrow + dispute resolution contract
// Canonical: packages/shared/src/schemas/dispute-escrow.schema.ts
// - Spec-verbatim: DisputeReasonEnum (7) / DisputeStatusEnum (6) /
//   EscrowStatusEnum (5) / CreateDisputeInputSchema / ResolveDisputeInputSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - orderId/disputeId accept min(1) edge vocabulary in addition to uuid
//     (Phase 023-031 precedent; LIFF deep-links carry short ids).
//   - Resolve accepts the 3 open states (SUBMITTED / AWAITING_SELLER_RESPONSE
//     / UNDER_ADMIN_ARBITRATION) — spec §5.2 gates SUBMITTED only, but the
//     seller-respond/admin-begin transitions below would otherwise be dead.
// - Pure helpers: disputeNo, escrowHoldingUntil, escrowExpired,
//   claimFrequencyRisk, refundCap, escrow/dispute keys. Budgets: 7-day hold,
//   ≥1 evidence, 24h MTTR target, 3-claims/month fraud trip.
// - Zero new deps (zod only).
import { z } from 'zod';

export const DisputeReasonEnum = z.enum([
  'PHYSICAL_ITEM_DAMAGED',
  'PHYSICAL_ITEM_NOT_RECEIVED',
  'WRONG_ITEM_SENT',
  'EBOOK_FILE_CORRUPTED',
  'COURSE_CONTENT_MISMATCH',
  'DUPLICATE_PAYMENT',
  'OTHER',
]);
export type DisputeReason = z.infer<typeof DisputeReasonEnum>;

export const DisputeStatusEnum = z.enum([
  'SUBMITTED',
  'AWAITING_SELLER_RESPONSE',
  'UNDER_ADMIN_ARBITRATION',
  'APPROVED_REFUND_BUYER',
  'REJECTED_RELEASE_SELLER',
  'CANCELLED_BY_BUYER',
]);
export type DisputeStatus = z.infer<typeof DisputeStatusEnum>;

export const EscrowStatusEnum = z.enum([
  'HELD',
  'DISPUTED_HOLD',
  'RELEASED_TO_SELLER',
  'REFUNDED_TO_BUYER',
  'PARTIALLY_REFUNDED',
]);
export type EscrowStatus = z.infer<typeof EscrowStatusEnum>;

export const CreateDisputeInputSchema = z.object({
  orderId: z.string().min(1),
  reason: DisputeReasonEnum,
  description: z.string().min(10, 'กรุณาระบุรายละเอียดอย่างน้อย 10 ตัวอักษร').max(2000),
  evidenceImageUrls: z.array(z.string().url()).min(1, 'ต้องแนบรูปภาพหลักฐานอย่างน้อย 1 รูป'),
  requestedRefundAmount: z.number().positive(),
});
export type CreateDisputeInput = z.infer<typeof CreateDisputeInputSchema>;

export const ResolveDisputeInputSchema = z.object({
  disputeId: z.string().min(1),
  resolutionStatus: DisputeStatusEnum,
  adminComment: z.string().min(5),
  approvedRefundAmount: z.number().min(0),
  refundToWallet: z.boolean().default(true),
});
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeInputSchema>;

/** Actionable (non-terminal) dispute states. */
export const DISPUTE_OPEN_STATES = ['SUBMITTED', 'AWAITING_SELLER_RESPONSE', 'UNDER_ADMIN_ARBITRATION'] as const;

/** Terminal dispute states. */
export const DISPUTE_TERMINAL_STATES = ['APPROVED_REFUND_BUYER', 'REJECTED_RELEASE_SELLER', 'CANCELLED_BY_BUYER'] as const;

/** 113 §1.3 BDD: funds locked for a 7-day holding period. */
export const ESCROW_HOLD_DAYS = 7;
/** 113 §7: ≥3 buyer claims in 30 days trips HIGH_RISK_FRAUD. */
export const DISPUTE_FRAUD_MONTHLY_LIMIT = 3;
/** 113 §7: dispute MTTR SLA target (24 hours, ms). */
export const DISPUTE_MTTR_SLA_MS = 24 * 60 * 60 * 1000;
/** Admin arbitration queue page size. */
export const DISPUTE_QUEUE_PAGE_SIZE = 20;
/** Dispute/escrow event stream (Gate 8). */
export const DISPUTE_EVENT_STREAM = 'stream:dispute:events';

/** Human-readable claim number, e.g. DSP-MJ3K9Q-4821. */
export function buildDisputeNo(nowMs: number, rand4: number): string {
  return `DSP-${nowMs.toString(36).toUpperCase()}-${String(Math.floor(rand4) % 10000).padStart(4, '0')}`;
}

export function escrowHoldingUntil(fromMs: number): Date {
  return new Date(fromMs + ESCROW_HOLD_DAYS * 24 * 60 * 60 * 1000);
}

/** True when the 7-day window has elapsed (dispute no longer fileable). */
export function escrowExpired(holdingUntil: Date | string, nowMs: number): boolean {
  return new Date(holdingUntil).getTime() <= nowMs;
}

/** Cap an approved refund at the requested amount and escrow gross. */
export function refundCap(requested: number, gross: number, approved: number): number {
  return Math.min(Math.max(0, approved), Math.max(0, requested), Math.max(0, gross));
}

/** Fraud trip: ≥3 claims in the trailing 30 days (§7 AI signal). */
export function claimFrequencyRisk(claims30d: number): 'NORMAL' | 'HIGH_RISK_FRAUD' {
  return claims30d >= DISPUTE_FRAUD_MONTHLY_LIMIT ? 'HIGH_RISK_FRAUD' : 'NORMAL';
}

export function escrowKey(orderId: string): string {
  return `escrow:order:${orderId}`;
}

export function disputeQueueKey(status: string, page: number): string {
  return `dispute:queue:${status}:${page}`;
}
