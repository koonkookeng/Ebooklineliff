# ADR-007: Cross-Platform QR Login Sync (LIFF Mobile → Desktop Web)

- Status: Accepted (Atomic Phase 007, PHASE-007-QR-SYNC)
- Date: 2026-10-06
- SSOT: `packages/db/prisma/schema.prisma` (`QrStatus`, `QrSessionNonce`, `UserDeviceSession`)
  + `packages/shared/src/schemas/auth-contract.ts` (QR §3.1 schemas)

## Context

Desktop Web login without passwords: an authenticated LINE LIFF session authorizes a desktop
browser via a scanned QR code, handshake budget <500ms, LIFF RAM <20MB, zero-trust.

## Decision

1. **SSE, not WebSocket/socket.io** (§1 permits "WebSocket/SSE"). No new backend deps
   (`@nestjs/websockets`, `socket.io` avoided); manual SSE on the Fastify raw reply +
   Redis pub/sub fan-out per `qr:{qrToken}` channel. A dedicated duplicate Redis connection
   serves subscriptions (cluster-safe; never blocks the command connection).
2. **Hot state in Redis (60s TTL), Postgres for audit.** `QrSessionNonce` /
   `UserDeviceSession` rows exist for traceability + device binding; the nonce itself never
   leaves the server (only its HMAC hash is stored).
3. **Sealed envelope, no client secrets.** The QR deep-link carries
   `?qrToken=&e=` where `e` is a server-HMAC-sealed `{qrToken, nonce, exp}` envelope.
   Integrity/expiry verify statelessly; single-use enforced statefully (consume-on-complete).
   The LIFF client holds no shared secret — it authenticates with its own session Bearer
   token (validated server-side). A shipped client secret would be extractable and is
   therefore deliberately not used (zero-trust).
4. **Scan-then-confirm order** (`PENDING → SCANNED → AUTHORIZED`), direct
   `PENDING → AUTHORIZED` allowed for atomic clients; `AUTHORIZED` is consumed exactly once
   by the desktop handoff (`complete`), which mints the `Session`, binds the desktop
   `UserDeviceSession` (fingerprint + IP), and sets `__Host-` cookies.
5. **Adaptive risk → PIN step-up.** Deterministic score (cross-device IP mismatch 65,
   unknown fingerprint 20, repeated attempts); ≥80 forces a 6-digit PIN displayed on the
   desktop and typed on LIFF (possession proof of both devices).
6. **Small QR render dep.** `react-qr-code` added to the frontend (single tiny dep, no
   transitive weight); no icon/animation libs — states render with CSS only to protect the
   LIFF RAM budget.

## Consequences

- Desktop: `QR_INIT → QR_PENDING → QR_SCANNED → SUCCESS | EXPIRED/ERROR` with 60s
  countdown + one-click refresh; handoff <500ms on the logic path (measured ~5ms in tests).
- LIFF: deep-link auto-scan, confirm drawer, offline queue notice, reject path.
- Follow-ups: push-based (instead of 15s SSE heartbeat) keepalive tuning; geo-IP signal
  for the risk engine when a provider is approved.
