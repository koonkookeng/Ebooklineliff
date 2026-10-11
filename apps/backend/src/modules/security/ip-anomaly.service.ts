// SSOT Phase 120 §5.1 — Legacy ip-anomaly alias (canonical: modules/security/services)
// - The anomaly single source lives in services/ip-anomaly.service.ts (§9 —
//   no duplicated scoring logic). This file only re-exports it for the
//   IN_SCOPE module path. Zero new deps.
export { IpAnomalyService, type LoginVerdict } from './services/ip-anomaly.service';

// Back-compat alias for the early double-suffixed class name.
export { IpAnomalyService as IpAnomalyServiceService } from './services/ip-anomaly.service';
