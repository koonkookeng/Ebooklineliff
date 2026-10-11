// SSOT Phase 100 — Legacy entitlement alias (canonical: modules/stream/live-gatekeeper.service)
// - The live gatekeeper single source lives in the stream module (§9 — no
//   duplicated entitlement logic). This file only re-exports it for the
//   IN_SCOPE entitlement path. Zero new deps.
export { LiveGatekeeperService, type GateCache, type GateResult } from '../stream/live-gatekeeper.service';

// Back-compat alias for the early double-suffixed class name.
export { LiveGatekeeperService as LiveGatekeeperServiceService } from '../stream/live-gatekeeper.service';
