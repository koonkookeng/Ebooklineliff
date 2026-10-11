// SSOT Phase 128 §5.1 — entitlement GraphQL batching module
// Canonical: apps/backend/src/modules/entitlement/entitlement.module.ts
// (legacy src/backend/modules/entitlement/*)
// - Provides per-request DataLoader factories over the global Prisma pool
//   (single pool, no new connections). Resolvers create one loader per
//   request (request cache); the module only owns the factory wiring.
// - Zero new deps (zero-dep batcher, 062 precedent).
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  createEntitlementLoader,
  createOrderLoader,
} from '../../api/graphql/dataloaders/entitlement.dataloader';

export const ENTITLEMENT_LOADER_FACTORY = 'ENTITLEMENT_LOADER_FACTORY';
export const ORDER_LOADER_FACTORY = 'ORDER_LOADER_FACTORY';

@Module({
  providers: [
    {
      provide: ENTITLEMENT_LOADER_FACTORY,
      useFactory: (prisma: PrismaService) => () => createEntitlementLoader(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: ORDER_LOADER_FACTORY,
      useFactory: (prisma: PrismaService) => () => createOrderLoader(prisma as never),
      inject: [PrismaService],
    },
  ],
  exports: [ENTITLEMENT_LOADER_FACTORY, ORDER_LOADER_FACTORY],
})
export class EntitlementModule {}

/** Compat alias for the scaffold stub name (no behavior change). */
export const EntitlementModuleModule = EntitlementModule;
