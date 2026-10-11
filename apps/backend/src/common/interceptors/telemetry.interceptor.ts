// SSOT Phase 121 Task 4 §5.1/BDD-1 — W3C trace propagation interceptor
// Canonical: apps/backend/src/common/interceptors/telemetry.interceptor.ts
// (legacy src/backend/common/interceptors/telemetry.interceptor.ts)
// - Extracts inbound traceparent (fresh ids on miss), runs the handler in
//   ALS context with tenant/user binding, echoes traceparent downstream,
//   and logs completion with duration (slow spans >1s warn — the 1.5ms
//   export budget is measured at the OTLP seam, not here).
// - Also syncs Pino context (the §5 tree's logging-interceptor lane is NOT
//   in scope — this interceptor owns context sync; documented).
// - Fail-open: tracing never breaks request handling. Zero new deps.
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { resolveInboundContext, runWithTrace } from '../../infra/observability/trace-context.holder';

type LooseReq = Record<string, unknown>;
type LooseRes = { setHeader?: (name: string, value: string) => void };

@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TelemetryInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const req = context.switchToHttp().getRequest<LooseReq>();
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    const tenant = headers['x-tenant-id'] ?? headers['x-tenant-slug'] ?? 'default';
    const { context: trace, responseHeader } = resolveInboundContext(headers['traceparent'], {
      tenantId: tenant,
      ...(user.id ? { userId: user.id } : {}),
    });
    req['traceContext'] = trace;
    const res = context.switchToHttp().getResponse<LooseRes>();
    try {
      res.setHeader?.('traceparent', responseHeader);
    } catch {
      // Header echo is best-effort.
    }
    return runWithTrace(trace, () =>
      next.handle().pipe(
        tap({
          next: () => {
            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs > 1000) {
              this.logger.warn(`Slow span ${trace.traceId}/${trace.spanId}: ${elapsedMs}ms`);
            }
          },
        }),
      ),
    );
  }
}
