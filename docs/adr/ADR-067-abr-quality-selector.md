# ADR-067: Automatic Quality Selector (Network-Aware ABR)

- Status: Accepted (Atomic Phase 067, PHASE-067-AVQ)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/video-quality-schema.ts`
  (`VideoQualityLevelEnum` AUTO + 4 rungs, `NetworkMetricsSchema`,
  `VideoStreamManifestSchema`, `StreamTelemetryPayloadSchema` +
  `QUALITY_LADDER` 4500/2500/1200/600kbps + hysteresis budgets +
  `selectQualityFor`/`ladderIndexOf` pure engine)
  + Prisma `VideoStreamQuality` / `VideoStreamTelemetry`
  (+ `User.streamTelemetry` back-relation)

## Context

Phase 044 owns the transcode ladder (`VideoQuality` RES_* enum +
`VideoQualityVariant` rows); Phase 050/053 own segment auth; Phase 055
owns tier policy. Phase 067 adds the client-facing ABR layer: manifest
with variants, network-aware auto-selection with anti-flapping
hysteresis, and a telemetry ledger — without touching the transcode
pipeline (OUT_OF_SCOPE_STRICT).

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `hls.js` (not installed; native `<video>` HLS only —
     `HlsVideoPlayer` precedent). Variant switching = src swap at
     currentTime (no MSE buffer to cap; RAM stays native-managed).
     MSE back-buffer GC (§10) is therefore N/A; documented follow-up.
   - No `lucide-react` (not installed) — inline SVG wifi/gear icons.
   - New `VideoStreamQuality` enum (spec values) instead of reusing the
     Phase 044 `VideoQuality` (RES_* rows untouched — zero migration risk).
   - Self-contained `QualityModule` (avoids the heavy StreamModule
     FFmpeg chain); manifest issuance is the entitlement gate
     (lesson → section → course → productId, preview bypass); segment
     auth rides the existing HLS session guard (no new token format).
2. **ABR policy (pure, tested):** 80%-of-throughput fit; saveData caps
   at 480p; downscale immediate (≤2 chunk cycles); upscale only after
   >8Mbps sustained 8s; manual menu locks a rung; ≥2 stalls force 360p.
3. **Telemetry:** Zod-gated ledger row + `events:stream-telemetry`
   stream, both best-effort (never blocks playback); proxy 202 on outage.
4. **UI:** `AdaptiveVideoPlayer` 5-state (skeleton/badge/spinner/toast/
   fallback+retry), `useNetworkBandwidth` (NetworkInformation + 4s RTT
   probe + change events), proxies for manifest/telemetry.

## Consequences

- Zero-buffering ABR on native-HLS devices; MSE devices keep existing players.
- Follow-ups: hls.js MSE engine with 12s/15MB buffer caps (§5/§10),
  AI predictive initial quality (§7.1).
