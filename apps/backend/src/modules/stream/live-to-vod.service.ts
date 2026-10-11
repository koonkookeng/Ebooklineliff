// SSOT Phase 102 — Legacy live-to-VOD alias (canonical: modules/stream/application)
// - The pipeline single source lives in application/live-to-vod.service.ts
//   (§9 — no duplicated orchestration logic). This file only re-exports it
//   for the IN_SCOPE stream path. Zero new deps.
export { LiveToVodService } from './application/live-to-vod.service';

// Back-compat alias for the early double-suffixed class name.
export { LiveToVodService as LiveToVodServiceService } from './application/live-to-vod.service';
