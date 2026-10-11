// SSOT Phase 125 Task 4 §5.2 — read/write routing interceptor (Gate 7)
// Canonical: apps/backend/src/infra/connection-pool/read-write-interceptor.ts
// (legacy src/backend/infra/connection-pool/read-write-interceptor.ts)
// - REST-first: GET/HEAD → read-replica flag; mutations → primary.
//   GraphQL best-effort: query operations → replica, mutations → primary
//   (lazy @nestjs/graphql lookup — no hard import cycle). The flag is
//   advisory (services default to primary when unset).
// - Zero new deps.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

export const READ_REPLICA_FLAG = 'useReadReplica';

function isReadMethod(method: unknown): boolean {
  return method === 'GET' || method === 'HEAD';
}

function gqlOperationIsQuery(context: ExecutionContext): boolean | null {
  try {
    const loader = eval('require') as (id: string) => {
      GqlExecutionContext?: { create(ctx: unknown): { getInfo(): { operation?: { operation?: string } } | undefined } };
    };
    const mod = loader('@nestjs/graphql');
    const info = mod.GqlExecutionContext?.create(context).getInfo();
    const op = info?.operation?.operation;
    if (op === 'query') return true;
    if (op === 'mutation' || op === 'subscription') return false;
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class ReadWriteInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const gqlVerdict = gqlOperationIsQuery(context);
    if (gqlVerdict !== null) {
      const req = this.requestOf(context);
      if (req) req[READ_REPLICA_FLAG] = gqlVerdict;
      return next.handle();
    }
    try {
      const http = context.switchToHttp();
      const req = http.getRequest<Record<string, unknown>>();
      if (req) req[READ_REPLICA_FLAG] = isReadMethod(req['method']);
    } catch {
      // Non-HTTP contexts (schedules/workers) keep the primary default.
    }
    return next.handle();
  }

  private requestOf(context: ExecutionContext): Record<string, unknown> | null {
    try {
      return context.switchToHttp().getRequest<Record<string, unknown>>();
    } catch {
      return null;
    }
  }
}
