# ADR-062: Offline PWA Engine (Vanilla SW + IDB Queue + Bulk Flush)

- Status: Accepted (Atomic Phase 062, PHASE-062-PWA)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/offline-sync-schema.ts`
  (`SyncTargetTypeEnum`, `OfflineSyncQueueItemSchema`,
  `BulkOfflineSyncPayloadSchema`, `BulkOfflineSyncResponseSchema` +
  tenant-cache/queue helpers + 100-entry/7d/150MB/24h budgets)
  + `packages/db/prisma/schema.prisma` (new `OfflineDeviceSession`,
  `OfflineSyncLog`; progress tables reused untouched)

## Context

Offline reads already cached ad-hoc IDB cells per feature with no shared
queue, no SW, and no server flush — progress made offline was lost.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy)**: vanilla SW instead
   of workbox-*, native IndexedDB instead of `idb`. Same budgets, ~2KB SW
   core. No `ZodValidationPipe` global exists — boundary safeParse instead.
2. **Zero-trust bulk flush**: JWT identity owns every item (body userIds
   must match, else failedIds); monotonic page/watch writes so stale
   replays never rewind online state; analytics items fan out best-effort.
3. **Complements Phase 057**: realtime SSE stays the online path; the PWA
   queue + bulk endpoint is the offline path (shared monotonic semantics).
4. **Single host**: `PwaOfflineHost` in the root layout covers LIFF + Web;
   tenant cache namespaces + quota guard protect the 150MB budget.

## Consequences

- Flush failures stay queued (failedIds excluded from the ack); session
  ledger records SUCCESS/PARTIAL/FAILED per flush for support triage.
- Follow-up: AES-GCM envelope for cached chunk cells (§8.1).
