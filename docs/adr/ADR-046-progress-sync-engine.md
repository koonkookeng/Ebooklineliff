# ADR-046: Write-Behind Progress Sync (5s Heartbeat, Beacon, Flush)

- Status: Accepted (Atomic Phase 046, PHASE-046-PROGRESS-SYNC)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/progress-sync.schema.ts`
  (`SyncProgressInputSchema`, `SyncProgressPayloadSchema`,
  `LessonStreamStateSchema`, `BeaconProgressSchema`)
  + `packages/db/prisma/schema.prisma` (no migration — `CourseLearningProgress`
  @@unique[userId,lessonId] already covers §4.1)

## Context

Per-play heartbeats from millions of learners must land in <20ms without
IOPS-melting Postgres, survive unload/offline gaps, and reconcile
cross-device resume — reusing the Phase 043/045 delivery surfaces.

## Decision

1. **Write-behind (§4.2)**: heartbeats hit a Redis hash + heatmap ZSET only;
   a 30s unref'd scheduler flushes rows with buffer⨯DB max (cross-device
   safe) and recomputes completion from the stored duration (never from a
   bare flag). DB writes stay single-row atomic upserts.
2. **Two completion rules, documented**: buffer path uses the spec §5.2 ≥95%
   rule; the lesson heartbeat (045) keeps ≥90%. Both share helpers; the
   divergence is spec-verbatim per surface.
3. **Beacon without JWT (spec §5.2)**: sendBeacon carries no Authorization
   header, so identity rides the body — but the identical anti-cheat
   pipeline (monotonic max, duration clamp, velocity cap) runs regardless,
   so a spoofed userId can only advance its own claimed row.
4. **Anti-cheat (§8.1)**: fixed-window 2-per-5s (Redis INCR, 429 + PII-free
   log); velocity cap prior+3×elapsed+120s (scrub-tolerant); no scheduler,
   socket, or stream-writer deps (interval starter + injectable sink).
5. **No duplicate GQL fields**: the bare `syncLessonProgress` field stays
   with StreamPlaybackResolver (045, now buffer-delegated); the 046 module
   registers only `syncLessonProgressBuffered`.
6. **Client**: deduped 5s hook, beacon on hide/unload, guarded localStorage
   queue + online retry, full timer/listener cleanup (Gate 5); the lesson
   player composes the single stream engine (no fork) with a 500ms sync
   pulse dot.

## Consequences

- `scripts/test-phase046-contracts.ts`: 6 checks ×3 loops; regressions
  043/044/045 green; frontend clean, backend 0 new type errors (1 pre-existing
  legacy alias), Prisma valid (untouched).
- Follow-ups (out of scope): Redis Stream writer binding, entitlement
  re-check broadcast to players, server-driven completion certificates.
