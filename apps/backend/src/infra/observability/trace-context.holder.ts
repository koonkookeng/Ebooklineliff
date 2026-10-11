// SSOT Phase 121 Task 4 §5.1 — W3C trace context carrier (AsyncLocalStorage)
// Canonical: apps/backend/src/infra/observability/trace-context.holder.ts
// (legacy src/backend/infra/observability/trace-context.holder.ts)
// - Carries { traceId, spanId, tenantId, userId } across Prisma/Redis calls
//   within one request (BDD-1 propagation). Pure parse/build live in the
//   SSOT contract (Zero Redundant); this file owns the ALS lifecycle.
// - Zero new deps (node:async_hooks only).
import { AsyncLocalStorage } from 'node:async_hooks';
import { buildTraceparent, newTraceIds, parseTraceparent } from '@repo/shared';

export interface TraceContext {
  traceId: string;
  spanId: string;
  tenantId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Current context (undefined outside a traced request). */
export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/** Run fn inside a child span (fresh spanId, same trace). */
export function runWithChildSpan<T>(parent: TraceContext, fn: () => T): T {
  const child: TraceContext = { ...parent, spanId: `${Date.now().toString(16).slice(-8)}${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')}`.slice(0, 16) };
  return storage.run(child, fn);
}

/** Run fn inside a fresh root context (new ids, optional tenant/user). */
export function runWithRootTrace<T>(fn: () => T, extra?: { tenantId?: string; userId?: string }): T {
  const ids = newTraceIds();
  return storage.run({ ...ids, ...extra }, fn);
}

/**
 * Resolve inbound context: valid traceparent header wins, else fresh ids.
 * Returns the context plus the response header to echo downstream.
 */
export function resolveInboundContext(
  traceparentHeader: string | undefined,
  extra?: { tenantId?: string; userId?: string },
): { context: TraceContext; responseHeader: string } {
  const parsed = parseTraceparent(traceparentHeader);
  const context: TraceContext = parsed
    ? { traceId: parsed.traceId, spanId: parsed.spanId, ...extra }
    : { ...newTraceIds(), ...extra };
  return { context, responseHeader: buildTraceparent(context.traceId, context.spanId, true) };
}

/** Run fn inside an explicitly supplied context (tests/gateways). */
export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}
