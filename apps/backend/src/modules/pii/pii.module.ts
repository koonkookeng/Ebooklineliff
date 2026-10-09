// SSOT Phase 107 Task 2/4/7 — PiiModule (useFactory wiring, Gate 7 atomic vault)
// Canonical: apps/backend/src/modules/pii/pii.module.ts
// - PrismaService + RedisClusterService arrive via global InfraModule (single pool).
// - FieldEncryptionService is module-scoped (PDPA key material stays out of globals).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { PiiMaskingInterceptor } from '../../common/interceptors/pii-masking.interceptor';
import { PiiService } from './pii.service';
import { PiiController } from './pii.controller';
import { PiiResolver } from './pii.resolver';

@Module({
  controllers: [PiiController],
  providers: [
    {
      provide: FieldEncryptionService,
      useFactory: (): FieldEncryptionService => new FieldEncryptionService(),
    },
    {
      provide: PiiMaskingInterceptor,
      useFactory: (crypto: FieldEncryptionService): PiiMaskingInterceptor =>
        new PiiMaskingInterceptor(crypto),
      inject: [FieldEncryptionService],
    },
    {
      provide: PiiService,
      useFactory: (
        prisma: PrismaService,
        redis: RedisClusterService,
        crypto: FieldEncryptionService,
      ): PiiService => new PiiService(prisma as never, redis as never, crypto),
      inject: [PrismaService, RedisClusterService, FieldEncryptionService],
    },
    PiiResolver,
  ],
  exports: [FieldEncryptionService, PiiMaskingInterceptor, PiiService],
})
export class PiiModule {}
