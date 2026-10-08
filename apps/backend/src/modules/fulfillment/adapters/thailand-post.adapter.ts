// SSOT Phase 076 Task 2 — Thailand Post adapter (unified carrier pattern)
// Canonical: apps/backend/src/modules/fulfillment/adapters/thailand-post.adapter.ts
// - Re-export of the unified stub (carrier.adapter.ts); live HTTP attaches
//   at the unified seam behind LogisticsCarrierConfig credentials.
// - Zero new deps.
export { THAILAND_POST_ADAPTER as ThailandPostAdapter } from './carrier.adapter';
