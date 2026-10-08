# ADR-069: Network Monitor (Banner + Offline Queue + Ping)

- Status: Accepted (Atomic Phase 069, PHASE-069-NETMON)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/network-status.schema.ts`
  (`NetworkQualityEnum`, `NetworkStatusStateEnum` 5-state,
  `OfflineQueueActionTypeEnum` 4-type, `NetworkStatusPayloadSchema`,
  `OfflineQueueItemSchema`, `HealthPingResponseSchema` + budgets/
  `deriveNetworkState`/`networkQualityOf`/`queueItemIntegrity`)
  + Prisma `NetworkTelemetryLog` (+ `User.networkTelemetry`)

## Context

Phase 055/067 own bandwidth estimation (connection API + RTT probes for
reader/player adaptation). Phase 069 adds the user-visible layer: banner
states, a generic offline action queue (progress/bookmark/quiz — the 4
types other queues do not cover), an ultra-fast ping, and disconnection
telemetry.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `idb` package — native IndexedDB (`omni-network-offline-db`).
   - No `framer-motion` (not installed) — CSS translate3d banner
     (module RAM ≤1.5MB scalar-only).
   - `useNetworkStatus` is the single owner of banner online/offline
     state (§9); measurement hooks (055/067) keep their own cadences
     (different concerns: adaptation vs alerting).
   - Gate 4 signatures: SHA-256 integrity at enqueue + Zod shape +
     JWT ownership server-side (no client secrets; 068 trust precedent).
2. **Ping:** public GET, no DB touch (<5ms, <100B, no-store); 2s abort,
   10s cadence; <300ms stable / >1500ms degraded; silent ticks never
   flash the banner (announce only on online-event/manual retry).
3. **Flush:** per-item ack — client clears acked ids, bumps retryCount
   on failures; BDD-2's 3 actions route to monotonic progress upserts,
   quiz-attempt insert, bookmark toggle (all ownership-checked).
4. **Telemetry:** disconnection segments ≥5s → ledger row (QoE feed);
   JWT-optional so anonymous LIFF readers report via lineUserId.
5. **UI:** `NetworkMonitorProvider` (null-render host) mounted in the
   LIFF layout; banner safe-area aware, 2.5s online toast, retry button.

## Consequences

- Offline actions survive flapping connections; stalls converge monotonically.
- Follow-ups: aggressive prefetch on DEGRADED (§7.1 AI hookup).
