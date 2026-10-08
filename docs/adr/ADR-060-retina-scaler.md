# ADR-060: Canvas Multi-Resolution Scaler (DPR-Adaptive Retina Core)

- Status: Accepted (Atomic Phase 060, PHASE-144-XZ-060)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/canvas-scaler.schema.ts`
  (`DprLevelEnum`, `ViewportMatrixSchema`, `CanvasResolutionConfigSchema`,
  `EbookMultiResChunkPayloadSchema` + `targetDprFor`/`dprVariantFor`/
  `canvasMemoryMb`/`viewportMatrixFor`/`slidingWindowRamMb`/
  `adaptiveDownscale`/`scalerTenantVars` + DPR/window/AI budgets)
  + Prisma reference-only (EbookDetail/EbookChapter/EbookReadingProgress
  reused; zero migrations — OUT_OF_SCOPE_STRICT respected)

## Context

Vector pages blurred on DPR 2–3 displays while LIFF RAM must stay <30MB.
Chunk fetching, DPR math, and watermarking lived in separate paths with
no variant cache key and a fixed 600×900 backing store.

## Decision

1. **Variant-keyed edge cache**: `ebook:{product}:page:{n}:dpr:{t}` (3600s)
   → R2 master SVG; HMAC 12-hex watermark (Phase 040 precedent);
   `hasNext` resolved from `EbookDetail.totalPages`.
2. **Central DPR math** (`DynamicDprManager` + `useRetinaCanvasScaler`):
   stepped caps (3/2/1), tenant `--retina-dpr-cap`, window RAM model
   (active + 2×1.5x ≈ 17.25MB ref), AI downscale (<45fps×3 / >25MB).
3. **Surgical integration**: compressed-view blit adopts a DPR backing
   store capped at 12MB/canvas; legacy fixed stores retired on that path
   only. REST (public LIFF) + code-first GQL share the service; telemetry
   rides the existing analytics pulse beacon (best-effort).

## Consequences

- Retina-crisp vectors with zero egress change (R2 + edge) and no new deps.
- Follow-up: backfill per-page aspect ratios to replace the 1.5 estimator.
