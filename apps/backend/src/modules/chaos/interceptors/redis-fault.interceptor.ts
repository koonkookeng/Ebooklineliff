// SSOT Phase 124 Task 2 §5.1 — Redis outage fault interceptor (BDD-1)
// Canonical: apps/backend/src/modules/chaos/interceptors/redis-fault.interceptor.ts
// (legacy src/backend/modules/chaos/interceptors/redis-fault.interceptor.ts)
// - Sampled REDIS_DOWN faults short-circuit with a typed CHAOS error so
//   the reader's existing fail-open lane (R2/IndexedDB fallback) engages.
//   Detection cost is one registry read (BDD-1 50ms budget trivially met).
//   Inactive drills pass through untouched (zero prod overhead beyond the
//   drillsEnabled() flag check).
// - Zero new deps.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { ChaosInjectorService } from '../chaos-injector.service';

@Injectable()
export class RedisFaultInterceptor implements NestInterceptor {
  constructor(
    private readonly chaos: ChaosInjectorService,
    private readonly targetService = 'reader-chunk',
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<ReturnType<CallHandler['handle']>> {
    if (!ChaosInjectorService.drillsEnabled()) return next.handle();
    const fault = await this.chaos.isFaultActive(this.targetService, 'REDIS_DOWN');
    if (fault) {
      throw new ServiceUnavailableException('CHAOS_REDIS_DOWN: serving from fallback storage');
    }
    return next.handle();
  }
}
