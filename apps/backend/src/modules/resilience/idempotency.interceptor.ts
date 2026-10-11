// SSOT Phase 122 Task 3 §5.2 — canonical re-export (scaffold-duplicate alias)
// Canonical: apps/backend/src/modules/resilience/idempotency.interceptor.ts
// (legacy src/backend/modules/resilience/idempotency.interceptor.ts)
// - Single implementation lives in interceptors/idempotency.interceptor.ts
//   (Zero Redundant Code); this file keeps the scaffold path importable.
export { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
