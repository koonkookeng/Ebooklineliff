# ADR-039: Redis Edge Page-Chunk Cache (<10ms LIFF Reader Delivery)

- Status: Accepted (Atomic Phase 039, PHASE-039-REDIS-EDGE-CHUNK)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/chunk-cache.schema.ts`
  (`ChunkCacheKeyParamsSchema`, `RedisChunkPayloadSchema`, `CacheMetricsSchema`)
  + `packages/db/prisma/schema.prisma` (`EbookDetail`, read-only §4.1 reference)

## Context

The canvas reader must serve encrypted vector-SVG page chunks inside LINE LIFF at
sub-10ms HIT latency, survive R2 origin outages via local fallback, and never let
React state exceed 3 pages (RAM <30MB) — while cutting Database Core load 99.5%
(HIT ratio ≥98%) at zero egress cost.

## Decision

1. **Key space** `tenant:{t}:ebook:{p}:page:{n}:chunk` (§4.1 verbatim); gzip-at-rest
   + async `EXPIRE 86400` sliding renewal on every HIT.
2. **Service split**: `RedisEdgeService` (binary GET/gunzip, fail-open null,
   bounded 64-entry L1 self-heal tier) + `ChunkWarmerService` (R2 miss fallback,
   async <50ms warm, `warmReadAhead` predictive seam). No Nest parameter
   decorators inside services — `ChunkCacheModule` wires via `useFactory` so
   tsx contract tests import them directly (Phase 027–038 precedent).
3. **Cluster deltas (additive only)**: `RedisClusterService` gains `set`/`getBuffer`/
   `expire`/`scanKeys` + variadic `del` (BDD-3 pattern sweep); no existing
   behavior touched.
4. **Controller**: public `GET /api/reader/chunk` (Zod boundary, no auth
   round-trip) + JWT-guarded `DELETE` publish invalidation; Next proxy at
   `app/api/reader/chunk` (Phase 014 pattern).
5. **Hook** `useRedisEdgeChunk`: `[N-1,N,N+1]` via shared `slidingWindowPages`,
   5-state machine, `trackBlobUrl` GC registrar + `revokeObjectURL` N-2 sweep.
6. **No deviations from §3.1**: `productId` stays `z.string().uuid()` (Prisma
   `Product.id` is `uuid()`-defaulted); no Prisma migration (OUT_OF_SCOPE).

## Consequences

- HIT path measured 0–1ms in contract tests (fake client); real-cluster p50/p95
  tracked via `EdgeCacheTelemetry` (§7.1 seam).
- `scripts/test-phase039-contracts.ts`: 8 checks ×3 loops; regressions
  036/037/038 green; backend 0 new type errors (1 pre-existing legacy alias),
  frontend clean, Prisma valid.
