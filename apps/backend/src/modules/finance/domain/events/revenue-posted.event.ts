// SSOT Phase 081 §7.1 — Finance domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/finance/domain/events/revenue-posted.event.ts
// - Consumers: wallet SSE fan-out, affiliate commission settlement (079),
//   reconciliation watcher. Zero new deps.
export const REVENUE_POSTED_EVENT = 'finance.revenue.posted';

export interface RevenuePostedEvent {
  event: typeof REVENUE_POSTED_EVENT;
  journalId: string;
  orderId: string;
  sellerUserId: string;
  grossAmount: number;
  at: number;
}
