# ADR-120: IP & Geolocation Anomaly Detection

## Status
Accepted — Phase 120 DONE (verified 100/100 x3).

## Context
Phase 120 spec requires login-velocity anomaly detection with <500ms
alerts — while 119 owns device-session fraud, 110 owns RiskLevel vocab,
106 owns a different SecurityAuditLog shape, 028 owns the SecurityModule
name, sdid-contract is read-only, and no /graphql rewrite or REST lane
exists for the new intents.

## Decision
- **Reuse, never fork:** RiskLevel enum reused as-is; SecurityAuditLog
  untouched (119's optional columns already cover event writes);
  119/028/106/110 lanes byte-identical. New names aliased at the barrel.
- **Local-first GeoIP:** static prefix table + Redis cache (<2ms hot);
  MaxMind swaps behind resolveIp. Private ranges never leave the box;
  unknown IPs fail open (never block login on missing geo).
- **Exact math:** Haversine verified against BKK↔TYO geography (spec's
  4,300 is approximate; real ≈4,600 — test bands carry reality, BDD
  vectors keep spec narrative); 799/801 boundary asserted; additive
  weights with documented precedence.
- **Honest expiry:** blacklists honor expiresAt; rotation uses DB sliding
  windows (Redis key namespace reserved for the edge migration); token
  revocation rides a stream to the auth lane (no token tables here).
- **One proxy:** a single allow-listed GQL passthrough (fixed documents,
  variables-only) bridges the IN_SCOPE page to the IN_SCOPE intents —
  without it the phase is dead code. No string interpolation.
- **Frontend dep-free:** no shadcn/lucide/tanstack (text glyphs + CSS),
  5-state sheet, <30MB profile.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state UI,
  spoof gate + fail-closed auth, text-only lists, zero-egress (local
  geo), atomic log writes, stream + Flex telemetry, this ADR.
- Regression: 120 x3 + 085/109/110/111/112/113/114/115/116/117/118/119
  green; backend/frontend clean; bundle guard PASS; zero new deps.
