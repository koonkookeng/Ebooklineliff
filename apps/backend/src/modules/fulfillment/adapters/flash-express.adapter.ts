// SSOT Phase 076 Task 2 — Flash Express adapter (unified carrier pattern)
// Canonical: apps/backend/src/modules/fulfillment/adapters/flash-express.adapter.ts
// - Re-export of the unified stub (carrier.adapter.ts); live HTTP attaches
//   at the unified seam behind LogisticsCarrierConfig credentials.
// - Zero new deps.
export { FLASH_ADAPTER as FlashExpressAdapter } from './carrier.adapter';
