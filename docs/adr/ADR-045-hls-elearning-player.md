# ADR-045: Cross-Platform HLS Player (ABR UI, Speed, Resume, Heartbeat)

- Status: Accepted (Atomic Phase 045, PHASE-045-HLS-PLAYER)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/stream-contract.ts`
  (`PlaybackSpeedEnum`, `VideoQualityEnum`, `LessonStreamPayloadSchema`,
  `SyncLessonProgressSchema`, `ProgressSyncResponseSchema`)
  + `packages/db/prisma/schema.prisma` (no migration — `CourseLesson` and
  `CourseLearningProgress` @@unique[userId,lessonId] already cover §4.1)

## Context

Lessons need one player for LIFF + Web with ABR UI, 0.5x–2.5x pitch-safe
speed, resume, and a 5s completion-aware heartbeat — reusing the Phase
043/044 delivery and ledger layers without new native dependencies.

## Decision

1. **Player without hls.js** (Phase 036/043 precedent): native `<video>`
   HLS + variant-source drawer (position-preserving reswap) + custom control
   bar (play/scrub/mute/speed/quality/fullscreen). `SpeedController` binds
   `playbackRate` + guarded `preservesPitch`; `QualitySelector` stays
   presentational. `onProgressSync` widened with optional `isCompleted`
   (backward compatible).
2. **State + heartbeat**: `getLessonStreamState` composes the 043 manifest
   (entitlement/token/watermark) with DB resume + duration; `syncLessonProgress`
   upserts with the shared ≥90% completion rule and emits the heatmap event
   through the existing sink (stream writer stays a follow-up, as in 043).
3. **Spec fidelity**: the GQL mutation takes `SyncLessonProgressInput!`
   (§3.2 verbatim); REST mirrors it 1:1 for the LIFF proxies.
4. **RAM**: no buffer tuning knobs without the MSE stack — the native
   element owns buffering; the 40MB budget is guarded by single-instance
   playback + src revocation on unmount (documented limitation).
5. **Secrets/PII**: tokens stay query-scoped + short-lived; no watch
   history in logs.

## Consequences

- `scripts/test-phase045-contracts.ts`: 6 checks ×3 loops (incl. the 043
  delivery regression in-file); 042/043/044 suites green; frontend clean,
  backend 0 new type errors (1 pre-existing legacy alias).
- Follow-ups (out of scope): hls.js MSE stack with buffer caps, Redis Stream
  writer, offline lesson packs, AI companion trigger on completion.
