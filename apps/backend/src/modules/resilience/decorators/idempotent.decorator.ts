// SSOT Phase 122 Task 3 §5.1 — @Idempotent() route decorator
// Canonical: apps/backend/src/modules/resilience/decorators/idempotent.decorator.ts
// (legacy src/backend/modules/resilience/decorators/idempotent.decorator.ts)
// - Marks POST/PUT handlers as idempotency-enforced: the interceptor
//   pass-through lane consults this metadata to require (not merely
//   accept) the X-Idempotency-Key header. Operators: key source
//   (header-only default) + per-route TTL overrides.
// - Zero new deps (NestJS SetMetadata only).
import { SetMetadata } from '@nestjs/common';

/** Metadata key consulted by the idempotency lane. */
export const IDEMPOTENT_METADATA = 'resilience:idempotent';

export interface IdempotentOptions {
  /** Require the header (true) vs accept-when-present (false, default). */
  required?: boolean;
  /** Override the 24h cached-response TTL (seconds). */
  recordTtlSec?: number;
  /** Override the 10s lock TTL (milliseconds). */
  lockTtlMs?: number;
}

/** Mark a route handler as idempotent (opt-in enforcement lane). */
export function Idempotent(options: IdempotentOptions = {}): MethodDecorator {
  return SetMetadata(IDEMPOTENT_METADATA, { required: false, ...options });
}

/** Read the decorator options for a handler (undefined = not marked). */
export function getIdempotentOptions(
  reflectorGet: (key: string) => IdempotentOptions | undefined,
): IdempotentOptions | undefined {
  return reflectorGet(IDEMPOTENT_METADATA);
}
