// SSOT Phase 120 §5.1 — Legacy risk alias (canonical: modules/security/services)
// - The risk single source lives in services/risk-calculator.service.ts (§9).
//   This file only re-exports it for the IN_SCOPE module path. Zero new deps.
export {
  RiskCalculatorService,
  classifyAnomaly,
  evaluateRisk,
  type RiskEvaluation,
} from './services/risk-calculator.service';

// Back-compat alias for the early double-suffixed class name.
export { RiskCalculatorService as RiskCalculatorServiceService } from './services/risk-calculator.service';
