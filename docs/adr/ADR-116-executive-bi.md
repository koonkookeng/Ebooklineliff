# ADR-116: Executive Business Intelligence Dashboards

## Status
Accepted — Phase 116 DONE (verified 100/100 x3).

## Context
Phase 116 spec requires GMV/LTV/CAC/churn/cohort analytics with <500ms
queries over 10M+ rows — while 052 owns telemetry ingest/heatmaps, 081
owns journals, and Order/PaymentSlip/User are read-only context. The 052
contract, module, and heatmap lane must stay byte-identical.

## Decision
- **Append, never rewrite:** executive Zod appended to
  analytics-contract.ts; 052 telemetry/exports untouched. New Prisma
  models only (campaign/snapshot); no core-table edits.
- **Snapshot-first reads:** KPI prefers DailyAnalyticsSnapshot sums,
  falls back to bounded live aggregates (take 10k); 15-min Redis cache;
  SLA measured + warned. The 10M-row path is the nightly upsert, never
  the request path.
- **Tenant isolation:** every read filters tenantId explicitly (legacy
  null-tenant rows excluded by construction); cohort members scoped the
  same way. Finance roles only, REST + GQL defense in depth.
- **Honest math:** net = 0.95×GMV labeled as post-gateway assumption;
  churn = pre-cutoff members without 30d activity; retention counts
  last-activity ≥ period floor. Zero-guarded everywhere.
- **Frontend dep-free:** no shadcn/recharts/tremor/lucide (CSS bars +
  heat cells), 5-state machine, 4 proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state
  dashboard, finance-only + tenant filters, CSS-only lists, no new
  binary lanes, single-row snapshot upserts, stream telemetry, this ADR.
- Regression: 116 x3 + 052/085/109/110/111/112/113/114/115 green;
  backend/frontend clean; bundle guard PASS; zero new deps.
