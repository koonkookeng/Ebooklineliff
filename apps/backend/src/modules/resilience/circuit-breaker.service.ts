// SSOT Phase 122 Task 4 §5.3 — canonical re-export (scaffold-duplicate alias)
// Canonical: apps/backend/src/modules/resilience/circuit-breaker.service.ts
// (legacy src/backend/modules/resilience/circuit-breaker.service.ts)
// - Single implementation lives in services/circuit-breaker.service.ts
//   (Zero Redundant Code); this file keeps the scaffold path importable.
export {
  CircuitBreakerService,
  CircuitBreakerServiceService,
  type CircuitRedisPort,
  type CircuitTransition,
} from './services/circuit-breaker.service';
