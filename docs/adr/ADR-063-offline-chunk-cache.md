# ADR-063: IndexedDB Offline Chunk Cache + DRM Lease Engine

- Status: Accepted (Atomic Phase 063, PHASE-063-OFFLINE-CACHE)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/offline-sync.schema.ts`
  (`OfflineStorageTypeEnum`, `SyncStatusEnum`, `DrmLeaseTokenSchema`,
  `OfflineEbookChunkSchema`, `OfflineVideoSegmentSchema`,
  `OfflineProgressSyncPayloadSchema` + 7d/24h/50MB/5-wide budgets)
  + `packages/db/prisma/schema.prisma` (new `DrmOfflineLease`;
  `OfflineSyncLog` additive user-audit columns; Phase 062 rows valid)

## Context

Phase 062 built the generic offline queue + bulk flush. Phase 063 adds the
media-cache half: chunk/segment IDB cells, 7-day DRM leases, an HLS/chunk
SW interceptor, and dedicated offline readers — without forking the 062
queue (progress records bridge into it).

## Decision

1. **RISK_CALL deviations**: native IndexedDB instead of Dexie.js
   (zero-new-dep LIFF policy, §4.2 store contract kept); `OfflineSyncLog`
   extended (not replaced) for the user-audit shape.
2. **Lease-gated offline**: entitlement-checked 7-day HMAC leases,
   idempotent re-issue, renewal when <24h remains; sync writes monotonic.
3. **Two workers, split scope**: `sw.js` (062, general PWA) vs
   `service-worker.js` (063, media interception) to avoid fetch-handler
   collisions; page-level `OfflineCanvasReader`/`OfflineHlsPlayer` render
   IDB cells with revoke-per-turn (<30MB) and `?offline=1` shelf entry.

## Consequences

- AES-GCM cell envelope stays a follow-up (cells hold server SVGs as-is).
- Progress records flow through the 062 bulk flush (single server path).
