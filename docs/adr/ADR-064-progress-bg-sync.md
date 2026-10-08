# ADR-064: Offline Progress Sync (Background Sync + Queue + Conflict Matrix)

- Status: Accepted (Atomic Phase 064, PHASE-064-BG-SYNC)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/progress-sync.schema.ts`
  (`ProgressTypeEnum`, `EbookProgressSyncItemSchema`,
  `CourseProgressSyncItemSchema`, `BatchProgressSyncPayloadSchema`,
  `SyncResponseSchema` + `SYNC_BATCH_BUDGET_MS`/`SYNC_PAYLOAD_MAX_BYTES`/
  `SYNC_QUEUE_RAM_MB`/`SYNC_IDEMPOTENCY_TTL_SEC`/`SYNC_BACKOFF_*` +
  `syncItemCanonical`/`syncBatchDedupeKey`/`syncBackoffMs` shared engine)
  + Prisma `ProgressSyncAuditLog` (additive; Phase 057/062 tables reused)

## Context

Phase 057 shipped realtime SSE + write-behind progress. Phase 062 added a
generic offline queue + bulk flush. Phase 063 added media caches with DRM
leases. Phase 064 completes the offline-first loop: a tiny (<5MB) progress
queue, Background Sync API registration, server idempotency + conflict
resolution (highest-valid-progress wins, stale replay counts as conflict
resolved but acked), and a UI badge.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No new deps: native `EventSource` (SSE), native `fetch`, native
     `BroadcastChannel`, native IndexedDB (reuses 063 `AhongOfflineOmniCacheDB`).
   - No global `ZodValidationPipe` — boundary `safeParse` at controller/resolver.
   - `sw.js` stays vanilla (no workbox). Two tags: `sync-user-progress`
     (Phase 057 realtime queue) + `sync-offline-progress` (Phase 064
     offline queue).
2. **Zero-trust + idempotency + conflict matrix:**
   - Redis SETNX on `syncBatchId` (24h) → replays return `DUPLICATE` w/o rows.
   - Per-item monotonic upsert (highest `lastPage` / `watchedSec` wins).
   - Stale client replays count as `conflictsResolved` but are **acked**
     (removed from client queue) so UI never stalls.
   - HMAC signing optional (client unsigned by default; server verifies
     when present).
3. **UI + transport:**
   - `SyncStatusBadge` in root layout (covers LIFF + Web).
   - `useProgressSync` hook: throttled SSE + REST + offline queue
     (writes on failure/offline, flush on `online` event + BG sync tag).
   - `registerProgressSync` dual-tags `sync-user-progress` +
     `sync-offline-progress` (057 + 064 workers both catch).
4. **Complements existing:**
   - Phase 057 SSE keeps realtime when online.
   - Phase 062 bulk flush (`/api/v1/offline-sync/bulk`) stays the
     offline path for library/analytics.
   - Phase 063 media caches untouched.

## Consequences

- Offline progress never lost (queued ≤5MB RAM, flushed on reconnect).
- Stale replays acked → queue drains, no UI stall.
- Follow-up: optional client HMAC signing + server enforcement.