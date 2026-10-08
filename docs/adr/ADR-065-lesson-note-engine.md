# ADR-065: In-Video Lesson Note Engine (Timestamp Notes + AI + PDF)

- Status: Accepted (Atomic Phase 065, PHASE-144-XZ-065)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/lesson-note.schema.ts`
  (`NoteVisibilityEnum`, `Create/UpdateLessonNoteSchema`,
  `NoteSearchFilterSchema`, `LessonNote(Connection)Schema`,
  `AiNoteSummarySchema` + budgets/keys/format/sanitize helpers)
  + Prisma `NoteVisibility` / `LessonNote` (+ `User.notes`,
  `CourseLesson.notes` back-relations)

## Context

Phase 047 added pause-lock quizzes; Phase 052/057 track watch progress.
Phase 065 adds the learner's own layer: timestamp-linked notes captured
while watching HLS, searchable per lesson/course, summarizable, and
exportable to PDF — offline-capable on LINE LIFF (<30MB RAM, <100ms write).

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `dexie.js` — offline outbox reuses the shared
     `AhongOfflineOmniCacheDB.pendingSyncRecords` store with `note:*` ids
     + `LESSON_NOTE` type (zero IDB migration; Phase 064 queue skips
     `note:*` rows, note drain skips progress rows).
   - No `@apollo/client` in the engine (installed but heavy for LIFF) —
     fetch-based `note-client` over Next proxies; GQL resolver stays the
     code-first contract for external clients.
   - No external LLM call — deterministic extractive summarizer
     (keyword-density takeaways + action-hint items) with an identical-
     contract `summarizeViaLlm` seam for future wiring.
   - No PDF library — dep-free `%PDF-1.4` builder (Phase 019 pattern,
     multi-page) + forensic `sha256(userId)[:16]` footer + R2
     `putObjectBuffer` + 1h presigned GET (zero egress via CDN).
2. **Zero-trust + ownership:**
   - Entitlement gate `lesson → section → course → productId`
     (preview lessons bypass); update/delete check `note.userId`.
   - Server `sanitizeNoteContent` (script/iframe/on* strip); React
     auto-escapes on render; PDF text WinAnsi-escaped.
3. **Cache + analytics:** read-through edge cache 300s + invalidate on
   write; `note_created` → Redis Stream (heatmap) + optional hook.
4. **UI:** `useNoteStore` (dep-free external store, 5-state),
   `InVideoNoteEngine` (N-shortcut, auto-pause, 500ms debounce autosave,
   offline queue + toast), `NoteListDrawer` (seek/AI/PDF), surgical mount
   on the existing lesson page (DOM-video seek precedent, no player fork).
5. **Sync:** `queueOfflineNote` registers `sync-lesson-note`; `sw.js`
   fans out `ZENE_FLUSH_NOTE_QUEUE`; engine drains on `online` + SW
   message via `POST /api/v1/notes/sync` (client UUIDs → idempotent
   create + LWW update).

## Consequences

- Notes never lost offline; stale replays converge via LWW.
- Follow-ups: vector embeddings for semantic note search (§7.1),
  STUDY_GROUP visibility enforcement at share boundaries.
