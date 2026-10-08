// SSOT Phase 076 Task 2 — KEX Express adapter (unified carrier pattern)
// Canonical: apps/backend/src/modules/fulfillment/adapters/kex-express.adapter.ts
// - Re-export of the unified stub (carrier.adapter.ts); live HTTP attaches
//   at the unified seam behind LogisticsCarrierConfig credentials.
// - Zero new deps.
export { KEX_ADAPTER as KexExpressAdapter } from './carrier.adapter';
