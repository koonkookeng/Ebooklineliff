// SSOT Phase 052 §1.2 — webhooks-layer ingestion alias (no logic duplication).
// Canonical: apps/backend/src/api/webhooks/analytics.controller.ts
// (legacy src/backend/api/webhooks/analytics.controller.ts)
// - Single implementation lives in modules/analytics/controllers. This alias is
//   NOT registered in any module (route owned by AnalyticsModule) — it only
//   satisfies the boundary path (Gate 9).
export { AnalyticsIngestionController } from '../../modules/analytics/controllers/analytics-ingestion.controller';
