// SSOT Phase 120 §5.1 — Legacy geoip alias (canonical: modules/security/services)
// - The lookup single source lives in services/geoip-lookup.service.ts (§9).
//   This file only re-exports it for the IN_SCOPE module path. Zero new deps.
export { GeoipLookupService, isPrivateIp, type ResolvedGeo } from './services/geoip-lookup.service';

// Back-compat alias for the early double-suffixed class name.
export { GeoipLookupService as GeoipLookupServiceService } from './services/geoip-lookup.service';
