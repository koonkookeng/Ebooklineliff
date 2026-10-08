# ADR-070: Cross-Device Handoff (Vector-Clock SSOT + QR Sessions)

- Status: Accepted (Atomic Phase 070, PHASE-070-CROSS-DEVICE-SYNC)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/cross-device-sync.schema.ts`
  (`DeviceTypeEnum`, `ContentTypeEnum`, `DeviceSessionSchema`,
  `CrossDeviceSyncPayloadSchema`, `SessionHandshakeQrPayloadSchema` +
  keys/channel + `resolveCrossDeviceConflict` + budgets)
  + Prisma `CrossDeviceSyncState` / `HandshakeToken`
  (+ `User`/`Product` back-relations)

## Context

Phase 057 owns realtime room transport (SSE) + write-back worker for
progress; Phase 007 owns QR login sync (sealed HMAC nonce + GETDEL).
Phase 070 adds the handoff layer on top: authoritative vector-clock
state per (user, product, contentType), QR session tokens that authorize
a *second viewport* (not a login), a ≤2 viewport guard, and reader
toast/QR UI on both ends.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `socket.io-client` / `socket.io` (neither installed) — EventSource
     + REST over the generic `RedisPubSubAdapter` rooms (ADR-057); the
     GQL `Subscription` stays a contract declaration, transport is SSE.
   - No `@/components/ui` (not vendored) — Tailwind toast/QR dialog.
   - No `UserDeviceSession` repurposing (auth shape, Phase 022/056) and
     no `ActiveDeviceSession` schema touch (057) — new additive models
     only; the viewport guard counts recent rows by `userId` field.
   - No `VideoQuality`-style enum reuse issue: `ContentTypeEnum` wire
     values (`EBOOK_PAGE`/`COURSE_LESSON_VIDEO`) persist as `String`
     columns (no Prisma enum churn).
   - No `(desktop)/` tree (does not exist) — `(web)/reader` is the
     desktop canonical path.
2. **Vector clock (BDD-3):** ties/newer accept (clock+1, edge+DB+room);
   stale returns server truth with `conflictResolved` (client animates
   without reload). Offline LIFF moves adopt the edge clock on reconnect
   so they reconcile instead of forking.
3. **Handshake (BDD-4):** uuid token, Redis SETEX 120s, GETDEL single-use
   (capture-proof), owner-match, ≤2 recent viewports else DEVICE_LIMIT,
   Prisma audit row; LIFF scan via `liff.scanCodeV2` (installed) with
   manual fallback; QR pixels via `react-qr-code` (installed, 007).
4. **UI:** `useCrossDeviceSync` 5-state (debounced push, clock adopt),
   `CrossDeviceHandoff` (identity-gated mount, scan), `CrossDeviceSyncToast`
   (confirm jumps, dismiss keeps local), `HandshakeQrButton` (desktop).
   LIFF reader jumps via store (no reload); web jumps via param replace.
5. **Gateways:** reader/stream `*-sync.gateway.ts` re-export the 057
   transport (no duplicate registration); `SyncModule` hosts the new
   providers + `HandshakeController` (standard `controllers` array).

## Consequences

- <500ms handoffs with honest conflict + device-limit states.
- Follow-ups: watermark re-index payload on handshake (§8), aggressive
  prefetch triggers from transition analytics.
