# ADR-119: Device Fingerprint Binding & Stream Eviction

## Status
Accepted — Phase 119 DONE (verified 100/100 x3).

## Context
Phase 119 spec requires hardware-bound playback with <150ms eviction —
while 056/070 own viewport/device metrics, 106 owns a different
SecurityAuditLog shape, 050 owns HLS segment encryption, 120 owns sibling
files in modules/security, and infra SecurityModule (028) owns its name.
The 119 tree files were all scaffold.

## Decision
- **Extend, never replace:** DeviceType unioned (070 rows intact);
  SecurityAuditLog gained optional 119 columns (106 readers safe);
  User gained device/session wallets. The module class is
  DeviceSecurityModule (028 keeps its name).
- **Takeover, not just deny:** live-holder collisions evict the loser
  (row + audit + SSE + Flex) and hand the pointer to the winner; evicted
  sessions stay evicted (no flap-back); 2-beat grace absorbs network flap.
- **Honest seams:** one-time claims are exact DB rows (no bitmap API in
  the Redis client); playback tickets are device-bound HMACs while 050
  keeps segment keys; entitlement checks stay in their lanes; SSE is a
  latency-shortener over the 5s heartbeat, not the detector.
- **Fail-open edges, fail-closed gates:** Redis outage degrades to DB
  reads; guards deny on missing/forged context; fraud >85 locks via the
  109-freeze handoff (no user-table writes here).
- **Frontend lean:** spec-verbatim collector (200×50, WebCrypto), 5-state
  player shell, dep-free modal/manager, 7 proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state player,
  binding + eviction + HMAC guards, <30MB collector, zero-egress (no new
  binary lanes), atomic bind/session txns, stream + Flex telemetry, this ADR.
- Regression: 119 x3 + 085/109/110/111/112/113/114/115/116/117/118 green;
  backend/frontend clean; bundle guard PASS; zero new deps.
