// SSOT Phase 128 §5.2 — Prisma query time guard (> 50ms warns)
// Canonical: apps/backend/src/infra/prisma/prisma-query-logger.middleware.ts
// (legacy src/infra/prisma/prisma-query-logger.middleware.ts)
// - Spec-verbatim behavior: time every query, warn past SLOW_QUERY_MS (50ms),
//   debug-log the rest. Prisma 5 `$use` shape, installed once at bootstrap by
//   InfraModule (PrismaService itself stays untouched).
// - Pure evaluateQueryDuration exported for contract tests (no Nest/Prisma
//   runtime needed). Zero new deps.
import { Logger } from '@nestjs/common';
import { SLOW_QUERY_MS } from '@repo/shared';

const logger = new Logger('PrismaQueryPerformanceGuard');

export interface PrismaMiddlewareParams {
  model?: string;
  action: string;
  args?: unknown;
  dataPath?: string[];
  runInTransaction?: boolean;
}

export type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<unknown>;

export interface PrismaClientLike {
  $use(mw: (params: PrismaMiddlewareParams, next: PrismaMiddlewareNext) => Promise<unknown>): void;
}

/** Classify a finished query (slow => warn lane, else debug lane). */
export function evaluateQueryDuration(durationMs: number): 'slow' | 'ok' {
  return durationMs > SLOW_QUERY_MS ? 'slow' : 'ok';
}

export function formatQueryLine(params: PrismaMiddlewareParams, durationMs: number): string {
  return `Model: ${params.model ?? 'raw'} | Action: ${params.action} | Duration: ${durationMs}ms`;
}

export const PrismaQueryPerformanceMiddleware = async (
  params: PrismaMiddlewareParams,
  next: PrismaMiddlewareNext,
): Promise<unknown> => {
  const startTime = Date.now();
  const result = await next(params);
  const durationMs = Date.now() - startTime;

  if (evaluateQueryDuration(durationMs) === 'slow') {
    logger.warn(`[SLOW QUERY DETECTED] ${formatQueryLine(params, durationMs)}`);
  } else {
    logger.debug(formatQueryLine(params, durationMs));
  }

  return result;
};

/** Bootstrap installer (called once by InfraModule — idempotent by flag). */
let installed = false;
export function installQueryPerformanceGuard(client: PrismaClientLike): void {
  if (installed) return;
  installed = true;
  client.$use(PrismaQueryPerformanceMiddleware);
}

/** Test seam: reset the once-flag between isolated installs. */
export function resetQueryPerformanceGuardForTests(): void {
  installed = false;
}
