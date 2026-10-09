// SSOT Phase 100 §3.1 — Live entitlement DTOs (Zod-gated boundary)
// Canonical: apps/backend/src/modules/stream/dto/live-entitlement.dto.ts
// - Re-exports the SSOT contract; controllers/GQL import from here so the
//   HTTP layer never drifts from @repo/shared. Zero new deps.
export {
  LiveAccessStatusEnum,
  LiveEntitlementCheckSchema,
  PlaybackTokenResponseSchema,
  HeartbeatPayloadSchema,
  KickSessionEventSchema,
} from '@repo/shared';
export type {
  LiveAccessStatus,
  LiveEntitlementCheck,
  PlaybackTokenResponse,
  HeartbeatPayload,
  KickSessionEvent,
} from '@repo/shared';
