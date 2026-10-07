# ADR-043: Video Processing Pipeline (R2 Multipart → FFmpeg HLS, Zero-Egress)

- Status: Accepted (Atomic Phase 043, PHASE-144-XZ-043)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/video-pipeline-contract.ts`
  (`VideoStatusEnum`, `VideoResolutionEnum`, `InitiateUploadSchema`,
  `VideoTranscodeJobPayloadSchema`, `HlsManifestStreamPayloadSchema`)
  + `packages/db/prisma/schema.prisma` (`VideoStatus`, `VideoResolution`,
  `VideoAsset`, `VideoRendition` @@unique[videoId,resolution],
  `VideoKeyRotation`; client regenerated)

## Context

Course video must flow creator-upload → 4-rung HLS + AES-128 → entitled LIFF
playback with zero egress, without adding BullMQ/hls.js/ffmpeg binaries,
an image-CV stack, or touching entitlement-core/JWT-session shapes.

## Decision

1. **Upload without multipart-SDK**: N presigned 10MB PUTs under
   `raw-videos/{videoId}/part-*` (direct-to-R2, zero backend bytes); the part
   manifest derives deterministically from `fileSizeBytes` (no schema
   change); the transcoder concatenates in order. R2 gained binary-safe
   `getObjectBuffer`/`putObjectBuffer` (additive; text wrappers delegate).
2. **Queue without BullMQ** (Phase 038 doctrine): in-process FIFO, 500ms×2^n
   backoff, 3 retries → DLQ; the Cloudflare worker POSTs a secret-signed
   `VIDEO_RAW_UPLOADED` webhook (<200ms dispatch; failures rethrow for queue
   redelivery). Worker lives at the repo edge-worker home
   (`edge/cloudflare-workers/`, Phase 053 precedent) with structural platform
   types (no workers-types dep).
3. **Transcode without running FFmpeg in tests**: pure command builder
   (spec §5.3 bitrates verified, shell-escaped) + injected exec runner; the
   processor owns parts→concat→key-rotation→exec→upload→rendition→READY with
   FAILED truncation + rethrow for retry. AES-128 keys are per-video random
   16B hex, served raw only with a 300s HMAC token + entitlement (preview
   lessons bypass; key bytes no-store, never logged).
4. **Playback without hls.js** (Phase 036 precedent): native `<video>` HLS +
   manual variant drawer + 5-state machine + 5s telemetry into a Redis
   progress key (DB sync stays a Phase 046 seam); non-MSE engines get the
   ERROR fallback. Forensic layer reuses the Phase 042 overlay when a seed is
   present, CSS text otherwise.
5. **Secrets/PII**: worker/token secrets timing-safe compared; wrong worker
   secrets collapse to 404 (no oracle); userIdHash is sha256-bound.

## Consequences

- `scripts/test-phase043-contracts.ts`: 9 checks ×3 loops; regressions
  040/041/042 green; frontend clean, backend 0 new type errors (1 pre-existing
  legacy alias), Prisma valid + generated.
- Follow-ups (out of scope): BullMQ swap (seam-ready), hls.js MSE stack,
  thumbnail sprites, Whisper subtitle trigger on READY, admin transcode console.
