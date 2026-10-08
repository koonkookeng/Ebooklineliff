// SSOT Phase 054 §5.1 — root stream service alias (no logic duplication).
// Canonical: apps/backend/src/modules/stream/stream.service.ts
// (legacy src/backend/modules/stream/stream.service.ts)
// - Single implementation lives in services/stream.service.ts (Phase 043/045:
//   getLessonStreamState + syncLessonProgress with Redis write-behind).
//   This alias satisfies the §5.1 boundary path (Gate 9) without a second
//   implementation (§9 zero-redundancy).
export { StreamService } from './services/stream.service';
export type { StreamTables, StreamVault, StreamCache } from './services/stream.service';
