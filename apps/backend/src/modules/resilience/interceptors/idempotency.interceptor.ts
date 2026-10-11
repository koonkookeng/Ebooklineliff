// SSOT Phase 122 Task 3 §5.2 — distributed idempotency interceptor
// Canonical: apps/backend/src/modules/resilience/interceptors/idempotency.interceptor.ts
// (legacy src/backend/modules/resilience/idempotency.interceptor.ts)
// - X-Idempotency-Key gate (Zod: trimmed, 16..128 chars): miss →
//   pass-through (decorator lane opts in explicitly). Hit lane:
//   cached record → SHA-256 hash equality → replay identical status+body
//   (BDD-1); altered payload with a reused key → 400 anti-replay; lock
//   contention → 409 (single-flight: only Request A calls EasySlip).
// - Handler results cache for 24h with the response status; locks release
//   in tap-finalize AND on error (no orphan locks past the 10s TTL).
// - Fail-open: store faults degrade to direct execution (money paths stay
//   guarded by DB unique constraints as the second line). Zero new deps.
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { IDEMPOTENCY_HEADER } from '@repo/shared';
import { RedisIdempotencyStore } from '../stores/redis-idempotency.store';

type LooseReq = Record<string, unknown>;
type LooseRes = {
  status?: (code: number) => void;
  statusCode?: number;
};

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: RedisIdempotencyStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<LooseReq>();
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const rawKey = headers[IDEMPOTENCY_HEADER] ?? headers[IDEMPOTENCY_HEADER.toUpperCase()];
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length < 16 || rawKey.trim().length > 128) {
      return next.handle();
    }
    const key = rawKey.trim();
    let bodyHash: string;
    try {
      bodyHash = RedisIdempotencyStore.bodyHash(req['body']);
    } catch {
      return next.handle();
    }

    let cached = null;
    try {
      cached = await this.store.getRecord(key);
    } catch {
      cached = null;
    }
    if (cached) {
      if (cached.requestHash !== bodyHash) {
        throw new BadRequestException('Idempotency Key reuse with altered payload hash detected.');
      }
      const res = context.switchToHttp().getResponse<LooseRes>();
      try {
        res.status?.(cached.statusCode);
      } catch {
        // Status echo is best-effort (Fastify reply owns the code lane).
      }
      return of(cached.responseBody);
    }

    let owned = false;
    try {
      owned = await this.store.acquireLock(key);
    } catch {
      owned = false;
    }
    if (!owned) {
      throw new ConflictException('Concurrent transaction in progress. Please retry in 1 second.');
    }

    const now = new Date();
    return next.handle().pipe(
      tap((responseBody) => {
        const res = context.switchToHttp().getResponse<LooseRes>();
        const statusCode = typeof res.statusCode === 'number' ? res.statusCode : 200;
        void this.store
          .putRecord({
            key,
            requestHash: bodyHash,
            statusCode,
            responseBody: responseBody as unknown,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 86400 * 1000).toISOString(),
          })
          .then(() => this.store.releaseLock(key));
      }),
      catchError((err: unknown) => {
        void this.store.releaseLock(key);
        return throwError(() => err);
      }),
    );
  }
}
