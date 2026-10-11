// SSOT Phase 120 §5.1 — Legacy velocity alias (canonical: modules/security/services)
// - The velocity single source lives in services/velocity-checker.service.ts
//   (§9). This file only re-exports it for the IN_SCOPE module path.
//   Zero new deps.
export {
  VelocityCheckerService,
  calculateVelocity,
  rotationScreen,
  withinTolerance,
  type VelocityVerdict,
  type RotationVerdict,
} from './services/velocity-checker.service';

// Back-compat alias for the early double-suffixed class name.
export { VelocityCheckerService as VelocityCheckerServiceService } from './services/velocity-checker.service';
