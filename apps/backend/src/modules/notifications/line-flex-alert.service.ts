// SSOT Phase 120 Task 6 — notifications alias (zero-duplication re-export).
// Canonical: apps/backend/src/modules/notifications/line-flex-alert.service.ts
// The single implementation lives in modules/security/services (spec §5.1
// tree); this IN_SCOPE file only re-exports it.
export {
  LineFlexAlertService,
  LogOnlyFlexDelivery,
  buildSecurityAlertFlex,
  securityFlexByteSize,
  SECURITY_FLEX_BUDGET_BYTES,
} from '../security/services/line-flex-alert.service';
export type { SecurityAlertCard, FlexDeliveryPort } from '../security/services/line-flex-alert.service';
