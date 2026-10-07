# ADR-044: Lesson Transcode Jobs (HLS Ladder, 2MB Segments, Ledger)

- Status: Accepted (Atomic Phase 044, PHASE-044-HLS-TRANSCODE)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/video-transcode.contract.ts`
  (`TranscodeQualityEnum`, `TranscodeStatusEnum`, `VideoTranscodeJobSchema`,
  `HlsVariantMetadataSchema`)
  + `packages/db/prisma/schema.prisma` (`TranscodeStatus`, `VideoQuality`,
  `VideoTranscodeJob` @@unique lessonId, `VideoQualityVariant`
  @@unique[transcodeJobId,quality]; client regenerated)

## Context

Phase 043 built the asset pipeline (presigned parts, HLS delivery, AES key
server). Phase 044 owns the lesson-scoped transcode ledger: spec-verbatim
FFmpeg ladder, hard 2MB segment ceiling, milestone progress, variant rows,
and a DRM key gate by job — with no BullMQ/aws-sdk/fs-extra/hls.js.

## Decision

1. **Two ladders, one engine family**: the 044 ledger uses the spec §6.1
   ladder (3000k/1500k/800k/400k, `-hls_time 4`, `-g 120`, `chunk_%03d.ts`,
   `prog.m3u8`) while 043 keeps its asset ladder; both builders are pure and
   independently tested. `%v` expands to variant indexes, so playlists live
   at `{prefix}/{0..3}/prog.m3u8` — the ledger mirrors that layout exactly
   (caught and fixed in review).
2. **No new infra deps**: FIFO queue reuse (no BullMQ), node:fs (no
   fs-extra), R2StorageService binary put (no aws-sdk), native `<video>`
   studio preview (no hls.js), event-sink progress (no socket.io — the
   gateway seam stays for a future socket binding).
3. **Guards that bite**: every emitted `.ts` is measured before R2 sync and
   aborts the job (FAILED + cleanup + rethrow) on any >2MB segment; master
   playlists must parse as RFC 8216; variant rows skip zero-chunk qualities
   (Zod would reject them).
4. **Key DRM**: `/api/v1/stream/key?jobId=` re-checks entitlement through
   the lesson chain on every call and streams raw key bytes no-store; the
   studio preview and player never persist keys.
5. **Secrets/PII**: no ids, keys, or command output in logs (job id only).

## Consequences

- `scripts/test-phase044-contracts.ts`: 8 checks ×3 loops (incl. oversize
  abort + %v layout lock); regressions 041/042/043 green; frontend clean,
  backend 0 new type errors (1 pre-existing legacy alias), Prisma valid +
  generated.
- Follow-ups (out of scope): BullMQ/socket.io bindings, thumbnail sprites,
  Whisper trigger on COMPLETED, multi-audio/subtitle tracks.
