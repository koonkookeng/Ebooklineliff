# ADR-040: Memory-Safe Canvas Reader Engine (Sliding Window, <30MB)

- Status: Accepted (Atomic Phase 040, PHASE-040-READER)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/reader.schema.ts`
  (`ForensicWatermarkSchema`, `EbookChunkPayloadSchema`,
  `ReaderProgressPayloadSchema`, `ProgressSyncResultSchema`)
  + `packages/db/prisma/schema.prisma` (`Entitlement` @@unique[userId,productId],
  `EbookDetail`, `EbookReadingProgress` @@unique[userId,ebookId] — read-only,
  no migration)

## Context

The LINE LIFF canvas reader must render encrypted vector-SVG pages while the
client heap stays strictly below 30MB, survive offline gaps via IndexedDB, and
stamp every served page with a per-user forensic watermark — without forking
the Phase 039 edge transport or touching payment/HLS/R2 vault cores.

## Decision

1. **Transport reuse (no fork)**: `ReaderService` rides Phase 039
   `ChunkWarmerService` (tenant-isolated edge HIT + zero-egress R2 warm) and
   adds the §5.2 entitlement gate (403), `EbookDetail` bounds (404), and the
   `sha256(userId-APP_SECRET)[:12]` dynamic watermark. The §4.1 bare
   `reader:chunk:{p}:{n}` pattern is kept as `readerLegacyCacheKey()` for
   observability only — multi-tenant isolation (§2.1) wins for real keys.
2. **Deliberate spec deviations (RISK_CALL, all additive)**:
   - `ChunkCacheKeyParamsSchema.tenantId` gains `.default('default')` so the
     Phase 000 `CanvasReader` edge path (no tenant hint) keeps working inside
     the global uuid key space; `''` stays invalid. Phase 039 tests unaffected.
   - `useSlidingWindow(productId, page, tenantId='default')` adds the optional
     tenant third argument; the v1 controller prefers the JWT tenant, query is
     fallback only (clients can never spoof another tenant).
   - `syncEbookProgress` is fail-open on unknown books (offline-replay safe);
     `readDurationSec` is boundary-validated and emitted via an injectable
     dwell sink (default no-op) since no duration column exists (no migration
     per OUT_OF_SCOPE).
   - Services stay tsx-importable (no Nest parameter decorators); `ReaderModule`
     wires everything via `useFactory`. `resolveReaderIdentity()` is split into
     decorator-free `reader-identity.ts` for the same reason.
3. **Client RAM protocol**: `memoryManager` (pure window/evict/heap guards +
   generic blob-revocation sweep), `useSlidingWindow` (cache-first, IDB
   fallback, circuit-breaker at 30MB), `ForensicWatermark` (deterministic CSS
   tile overlay), `offline-chunk-cache` (zero-dep IDB chunk vault + progress
   queue). `CanvasReader` changed surgically only (watermark overlay state).
4. **Intent layer**: code-first `ReaderResolver` + SDL supplement
   `reader.graphql/schema.graphql` (§3.2 verbatim); Next proxies
   `app/api/v1/reader/{chunk,progress}` (JWT passthrough, Phase 014 pattern).
5. **Secrets**: watermarking requires `APP_SECRET` in env (prod); the service
   fails over to a dev seed rather than 500ing the reader (documented, never
   logged with userId).

## Consequences

- `scripts/test-phase040-contracts.ts`: 8 checks ×3 loops; regressions
  037/038/039 green; backend 0 new type errors (1 pre-existing legacy alias),
  frontend clean, Prisma valid.
- HIT latency inherits the Phase 039 <10ms edge path; progress sync is a
  single upsert (<50ms Gate 7); dwell events flow through the injectable sink
  (Gate 8 seam).
