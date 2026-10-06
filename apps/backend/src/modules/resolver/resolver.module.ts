// SSOT Phase 025 Task 2 — Resolver module
// Canonical: apps/backend/src/modules/resolver/resolver.module.ts
// (legacy src/backend/modules/resolver/resolver.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { HmacCryptoService } from './domain/services/hmac-crypto.service';
import { DeepLinkResolverService } from './application/services/deep-link-resolver.service';
import { ResolveDeepLinkUseCase } from './application/use-cases/resolve-deep-link.usecase';
import { CreateShortLinkUseCase } from './application/use-cases/create-short-link.usecase';
import { ShortLinkRepository } from './infrastructure/repositories/short-link.repository';
import { FastifyResolverController } from './infrastructure/controllers/fastify-resolver.controller';
import { ResolverResolver } from './resolver.resolver';

@Module({
  controllers: [FastifyResolverController],
  providers: [
    HmacCryptoService,
    ShortLinkRepository,
    DeepLinkResolverService,
    ResolveDeepLinkUseCase,
    CreateShortLinkUseCase,
    ResolverResolver,
  ],
  exports: [DeepLinkResolverService, ResolveDeepLinkUseCase, CreateShortLinkUseCase],
})
export class ResolverModule {}
