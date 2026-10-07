# ADR-042: Foreground Forensic Watermarking (Drifting Identity + Stego)

- Status: Accepted (Atomic Phase 042, PHASE-042-FORENSIC-WATERMARK)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/watermark-contract.ts`
  (`WatermarkMotionModeEnum`, `WatermarkSeedPayloadSchema`,
  `ForensicVerificationPayloadSchema`)
  + `packages/db/prisma/schema.prisma` (`WatermarkSeedLog` @@unique seedId,
  `SecurityViolationLog` + User/Product back-relations; client regenerated)

## Context

Screenshots and screen recordings need a per-viewer fingerprint that survives
cropping yet costs <2MB RAM inside the 30MB LIFF budget — without shipping an
image-CV dependency or touching the HLS transcoder / payment cores.

## Decision

1. **Two layers**: visible Lissajous-drifting identity text (60fps → 10fps
   idle throttle, opacity 0.12–0.25) + invisible 16×16 bottom-right RGBA
   manifest on the reader canvas. Video uses the same engine with stego off
   (re-encoded frames would not preserve alpha) — the drifting identity is
   the enforcement layer there.
2. **Seed trust**: `sha256(userId:secret)` 64-hex identity + HMAC over
   `seedId:userIdHash:timestamp`, timing-safe compare, 15-minute TTL with
   background refresh; audit log writes never block issuance (Gate 7).
3. **Deliberate limits (RISK_CALL, documented)**:
   - No server-side pixel decoding (no CV dep by LIFF policy): the canvas
     reads back its own alpha manifest and submits it with the bytes, so
     `extractForensicWatermark` is manifest-assisted (100 fresh / 50 stale /
     0+tampered forged-or-swapped, never misattributed).
   - No `@nestjs/config` (not a dep): secret via constructor
     (`WATERMARK_HMAC_SECRET` → `APP_SECRET` → dev fallback; prod must set it).
   - No Redis xadd binding: `watermark.seed_issued` / tamper events flow
     through an injectable sink (default no-op) until the stream writer lands.
   - Stray scaffold trees under `modules/watermark/backend/**` + `workers/`
     are out-of-scope artifacts and stay unregistered (asserted in tests).
4. **Anti-tamper**: closed Shadow DOM + MutationObserver →
   `SECURITY_VIOLATION` → content lock + async violation log (BDD-2); React
   overlay never re-attaches a live shadow root (mount-once + size sync).
5. **Secrets/PII**: no ids, secrets, or image bytes in logs; seed JSON <1KB
   (Gate 6 zero-egress).

## Consequences

- `scripts/test-phase042-contracts.ts`: 8 checks ×3 loops; regressions
  039/040/041 green; frontend clean, backend 0 new type errors (1 pre-existing
  legacy alias), Prisma valid + generated.
- Follow-ups (out of scope): Redis Stream writer binding, admin verify console
  for leaked-image upload, canvas-gesture highlight creation feeding seeds.
