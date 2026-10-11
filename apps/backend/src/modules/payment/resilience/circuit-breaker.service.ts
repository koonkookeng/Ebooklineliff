// SSOT Phase 124 Task 3 §5.2 — canonical re-export (single-breaker policy)
// Canonical: apps/backend/src/modules/payment/resilience/circuit-breaker.service.ts
// (legacy src/backend/modules/payment/resilience/circuit-breaker.service.ts)
// - RISK_CALL (documented): NO second breaker implementation — the 122
//   Redis-backed CircuitBreakerService is the single owner (Zero Redundant
//   Code). Payment lanes compose it via the 122 EasySlipCircuitAdapter +
//   the 124 chaos proxy + outbox worker. This file keeps the §5.1 tree
//   path importable.
export {
  CircuitBreakerService,
  CircuitBreakerServiceService,
  type CircuitRedisPort,
  type CircuitTransition,
} from '../../resilience/services/circuit-breaker.service';
