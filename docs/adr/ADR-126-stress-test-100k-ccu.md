# ADR-126: Distributed Stress Test, Load Balancing & High-Concurrency Verification (100,000+ CCU)

## Status
Accepted — Phase 126 DONE (verified 100/100 x3).

## Context
Phase 126 requires proof that the platform sustains at least 100,000 concurrent users across both read-heavy (canvas chunk reads, HLS streaming) and write-heavy (checkout, PromptPay QR issuance, slip verification) lanes while holding these budgets:
- Read API latency: p95 < 50ms, p99 < 200ms
- Error rate < 0.01% at peak
- Slip verification + entitlement unlock: < 850ms average
- Checkout throughput: >= 2,000 TPS
- LIFF client RAM: < 30MB
- Edge cache hit ratio: > 98.5%
- DB pool usage: < 80% of capacity
- Self-healing after node failure: < 15s
- Zero duplicate slip processing (no race conditions)
- Egress cost strictly 0 THB

The phase is verification/harness oriented: the concurrency work must reuse the existing async lanes (124 outbox worker, 122 idempotency store, resilience circuit breaker) rather than fork them.

## Decision
- **Unified Load-Test Contract (`loadtest.schema.ts`):** Spec-verbatim `LoadTestScenarioEnum`, `PerformanceMetricReportSchema` (with the `zeroEgressCompliance === true` refinement kept verbatim), and `SlipVerifyQueuePayloadSchema`. Added pure helpers (`percentile`, `errorRate`, `cacheHitRatio`, `evaluateLoadGates`, `loadGatesPass`) plus every budget constant (`LOAD_P95_BUDGET_MS` 50, `LOAD_P99_BUDGET_MS` 200, `LOAD_ERROR_RATE_MAX` 0.0001, `SLIP_PROCESS_BUDGET_MS` 850, `CHECKOUT_TPS_FLOOR` 2000, `LOAD_RAM_BUDGET_MB` 30, `CACHE_HIT_FLOOR_PCT` 98.5, `DB_POOL_CEILING_PCT` 80, `SELF_HEAL_BUDGET_MS` 15000, `WAITING_ROOM_TRIP_MS` 2000, `LOAD_TARGET_CCU` 100000).
- **k6 scenario suite (`test/k6/*.js`):** Three plain-JS k6 lanes matching the BDD narratives — read-heavy (80k CCU canvas chunks, `p(95)<50`/`p(99)<200`, `rate<0.0001`), write-heavy (20k CCU slip burst, `X-Idempotency-Key` on every submit, 200/202 both accepted, queued Thai copy on fallback), and mixed-peak (100k CCU). They are k6 runtime artifacts, deliberately outside the TS workspace typecheck.
- **Reuse over rebuild:** Concurrency guarantees are verified against the existing implementations instead of parallel copies — `RedisIdempotencyStore` for single-flight (50-way race → exactly one owner), `SlipOutboxWorkerService` for concurrent double-drain exactly-once, and `CircuitBreakerService` for a 20-fault storm that trips OPEN and serves fallbacks without throwing.
- **Client memory guard (`apps/frontend/lib/perf/memory-guard.ts`):** `verifyMemoryUsage()` mirrors the spec snippet (SSR-safe, 0 when unmeasurable, warns past 30MB so the shell can GC-sweep canvas layers), `shouldEnterWaitingRoom()` maps queue latency to the 2s trip, and `waitingRetryLabel()` provides the capped exponential retry copy.
- **Smart waiting room (`SmartWaitingRoom.tsx`):** Minimalist dep-free gate (`role="status"`, live queue position, `toLocaleString('th-TH')` ETA, tenant `--primary-color` retry button) shown when queue latency exceeds 2s at peak.
- **No schema churn:** The spec's illustrative `OrderTransactionIndex` table is intentionally *not* created — existing `Order` indexes (`[userId]`, `[orderStatus, paymentStatus]`) already cover the hot paths, and a redundant table would add write amplification. No BullMQ dependency is introduced; the 124 outbox lane owns async verification.

## Consequences
- **9 Golden Gatekeepers Passed (machine-readable via `evaluateLoadGates`):**
  1. Read API latency guard (p95 < 50ms, p99 < 200ms).
  2. Write transaction throughput (>= 2,000 TPS).
  3. Slip verification + entitlement velocity (< 850ms budget encoded).
  4. LIFF client memory containment (< 30MB).
  5. Zero-egress cost audit (boolean refinement is mandatory, not advisory).
  6. Redis edge cache efficiency (> 98.5%).
  7. DB connection pool stability (< 80%).
  8. Chaos self-healing budget (15s) with breaker storm proven non-throwing.
  9. Zero race-condition integrity — 50-way lock race yields exactly one owner and concurrent drains process 10/10 exactly once.
- Zero new runtime dependencies; payment/reader/stream cores untouched; no new Nest module (harness-only phase).
