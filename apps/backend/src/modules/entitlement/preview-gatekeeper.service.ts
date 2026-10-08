// SSOT Phase 051 §1.2 — entitlement-side alias (no logic duplication).
// Canonical: apps/backend/src/modules/entitlement/preview-gatekeeper.service.ts
// (legacy src/backend/modules/entitlement/preview-gatekeeper.service.ts)
// - Single implementation lives in modules/preview/services; this file only
//   re-exports the class + ports so both boundary paths resolve (Gate 9).
export {
  PreviewGatekeeperService,
  type PreviewDbPort,
  type PreviewEventSink,
  type PreviewIdentity,
} from '../preview/services/preview-gatekeeper.service';
