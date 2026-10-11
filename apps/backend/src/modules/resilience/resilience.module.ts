// SSOT Phase 122 Task 2 §5.1 — resilience composition module
// Canonical: apps/backend/src/modules/resilience/resilience.module.ts
// (legacy src/backend/modules/resilience/resilience.module.ts)
// - Provides + exports the store/lock/breaker/interceptor lanes over the
//   global InfraModule Redis (no new infra). Adapters are request-scoped
//   by callers (they wrap existing provider instances — no provider entry
//   here, keeping payment/notification cores untouched).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { RedisIdempotencyStore } from './stores/redis-idempotency.store';
import { DistributedLockService } from './services/distributed-lock.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';

@Module({
  providers: [
    {
      provide: RedisIdempotencyStore,
      useFactory: (redis: RedisClusterService) => new RedisIdempotencyStore(redis),
      inject: [RedisClusterService],
    },
    {
      provide: DistributedLockService,
      useFactory: (store: RedisIdempotencyStore) => new DistributedLockService(store),
      inject: [RedisIdempotencyStore],
    },
    {
      provide: CircuitBreakerService,
      useFactory: (redis: RedisClusterService) => new CircuitBreakerService(redis),
      inject: [RedisClusterService],
    },
    {
      provide: IdempotencyInterceptor,
      useFactory: (store: RedisIdempotencyStore) => new IdempotencyInterceptor(store),
      inject: [RedisIdempotencyStore],
    },
  ],
  exports: [RedisIdempotencyStore, DistributedLockService, CircuitBreakerService, IdempotencyInterceptor],
})
export class ResilienceModule {}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { ResilienceModule as ResilienceModuleModule };
