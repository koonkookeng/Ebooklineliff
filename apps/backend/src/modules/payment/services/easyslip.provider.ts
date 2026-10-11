// SSOT Phase 015 §5.1 — spec-path alias (tree lists services/easyslip.provider.ts).
// Canonical implementation lives at ../providers/easyslip.provider.ts
// (base64/URL verify + SlipOK fallback, zero new deps). This alias keeps the
// spec-listed import path valid without duplicating logic (single error source).
export {
  EasySlipProvider,
  SlipUnverifiableError,
  EASYSLIP_TIMEOUT_MS,
} from '../providers/easyslip.provider';
export type { SlipOkConfig } from '../providers/easyslip.provider';
