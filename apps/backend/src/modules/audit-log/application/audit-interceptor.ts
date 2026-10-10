// SSOT Phase 118 Task 3 §5.1/BDD-1 — audit interceptor + decorator
// Canonical: apps/backend/src/modules/audit-log/application/audit-interceptor.ts
// (legacy src/backend/modules/audit-log/application/audit-interceptor.ts)
// - @Audit(category, action, entity) marks sensitive handlers; the
//   interceptor appends AFTER success (actor/IP/UA from request, args body
//   as after-payload, before = null). Fail-open by design: the interceptor
//   cannot join the mutation's transaction, so critical financial paths must
//   call AuditLogService.append INSIDE their own txn (Gate 7) — documented,
//   asserted in 118 tests.
// - Zero new deps.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from './audit-log.service';

export const AUDIT_METADATA_KEY = 'audit:spec';

export interface AuditSpec {
  category: string;
  action: string;
  entity: string;
}

/** Mark a handler as audit-worthy (category/action/entity). */
export const Audit = (category: string, action: string, entity: string): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIT_METADATA_KEY, { category, action, entity } as AuditSpec);

type LooseReq = Record<string, unknown>;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const spec = (Reflect.getMetadata(AUDIT_METADATA_KEY, handler) ?? null) as AuditSpec | null;
    if (!spec) return next.handle();
    const req = context.switchToHttp().getRequest<LooseReq>();
    const user = (req['user'] as { id?: string; role?: string; email?: string } | undefined) ?? {};
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const fwd = headers['x-forwarded-for'] ?? '';
    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit
            .append(
              {
                id: user.id ?? 'unknown',
                role: user.role ?? 'UNKNOWN',
                email: user.email ?? 'unknown',
                ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
                userAgent: headers['user-agent'] ?? 'unknown',
              },
              {
                actionCategory: spec.category,
                actionName: spec.action,
                targetEntity: spec.entity,
                payloadAfter: (req['body'] as unknown) ?? null,
              },
            )
            .catch(() => undefined);
        },
      }),
    );
  }
}
