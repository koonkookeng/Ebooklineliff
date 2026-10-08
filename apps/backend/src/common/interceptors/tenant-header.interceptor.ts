// SSOT Phase 071 §7 — Tenant header interceptor (tenant-scoped pipeline)
// Canonical: apps/backend/src/common/interceptors/tenant-header.interceptor.ts
// (legacy src/backend/common/interceptors/tenant-header.interceptor.ts)
// - Propagates the guarded tenant context downstream: echoes X-Tenant-ID on
//   every response (edge/CDN + client store re-binding) so LIFF subsequent
//   calls keep carrying the header (§1.3 BDD-2).
// - Tags the request-scoped tenant id for analytics fan-in (§7: every event
//   payload stamped with tenant_id at the boundary, single place).
// - Passive when no tenant context exists (public routes) — never blocks.
// - Zero new deps (rxjs ships with NestJS).
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable, map } from 'rxjs';

@Injectable()
export class TenantHeaderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const gql = GqlExecutionContext.create(context);
    const gqlReq = gql.getContext()?.req as Record<string, unknown> | undefined;
    const http = context.switchToHttp();
    const httpReq = http.getRequest?.() as Record<string, unknown> | undefined;
    const req = gqlReq ?? httpReq;
    const headers = ((req?.['headers'] ?? {}) as Record<string, string | undefined>);
    const tenantId =
      (req?.['tenantId'] as string | undefined) ??
      headers['x-tenant-id'] ??
      headers['X-Tenant-ID'] ??
      null;

    return next.handle().pipe(
      map((data) => {
        if (!tenantId) return data;
        try {
          const res = http.getResponse?.() as
            | { setHeader?: (k: string, v: string) => void; set?: (k: string, v: string) => void }
            | undefined;
          res?.setHeader?.('X-Tenant-ID', tenantId);
        } catch {
          // Header echo is best-effort; never fail the request.
        }
        return data;
      }),
    );
  }
}
