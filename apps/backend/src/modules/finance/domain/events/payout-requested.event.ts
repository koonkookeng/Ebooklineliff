// SSOT Phase 081 §7.1 — Payout domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/finance/domain/events/payout-requested.event.ts
// - Consumers: bank-settlement worker (086), tax-reporting pipeline, wallet
//   SSE fan-out. Zero new deps.
export const PAYOUT_REQUESTED_EVENT = 'finance.payout.requested';
export const PAYOUT_APPROVED_EVENT = 'finance.payout.approved';

export interface PayoutRequestedEvent {
  event: typeof PAYOUT_REQUESTED_EVENT;
  payoutId: string;
  userId: string;
  grossAmount: number;
  netTransferAmount: number;
  at: number;
}
