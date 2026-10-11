// SSOT Phase 127 Task 4 — forensic watermark facade (OWASP A09 traceability)
// Canonical: apps/backend/src/modules/security/services/forensic-watermark.service.ts
// (legacy src/backend/modules/security/services/forensic-watermark.service.ts)
// - RISK_CALL: no math duplication — the canonical scalar layout engine is
//   the Phase 055 ForensicWatermarkService (../forensic-watermark.service.ts).
//   This file only re-exports it under the 127 services/ path so guards and
//   the reader lane share one implementation (048/082/114 delegate precedent).
// - Zero new deps.
export {
  ForensicWatermarkService,
  fnv1a32,
  type WatermarkDrawSpec,
} from '../forensic-watermark.service';
import { ForensicWatermarkService } from '../forensic-watermark.service';

/** Compat alias for the scaffold stub name (no behavior change). */
export const ForensicWatermarkServiceService = ForensicWatermarkService;
