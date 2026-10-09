// SSOT Phase 106 Task 5 — SecurityMatrixModule (useFactory wiring, Gate 7 atomic repo)
// Canonical: apps/backend/src/modules/security-matrix/security-matrix.module.ts
// (legacy src/backend/modules/security_matrix/security-matrix.module.ts)
// - PrismaService + RedisClusterService arrive via global InfraModule (single pool).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { BitwiseEvaluatorService } from '../../application/services/bitwise-evaluator.service';
import { ScopeMatcherService } from '../../application/services/scope-matcher.service';
import { RedisTokenBlacklistAdapter } from '../../infrastructure/adapters/redis-token-blacklist.adapter';
import { PrismaSecurityRoleRepository } from '../../infrastructure/persistence/prisma-security-role.repository';
import { BitwisePermissionGuard } from '../../presentation/guards/bitwise-permission.guard';
import { JwtScopeGuard } from '../../presentation/guards/jwt-scope.guard';
import { TokenScopeService } from '../auth/services/token-scope.service';
import { SecurityMatrixController } from './security-matrix.controller';
import { SecurityMatrixResolver } from './security-matrix.resolver';

@Module({
  controllers: [SecurityMatrixController],
  providers: [
    {
      provide: BitwiseEvaluatorService,
      useFactory: (): BitwiseEvaluatorService => new BitwiseEvaluatorService(),
    },
    {
      provide: ScopeMatcherService,
      useFactory: (): ScopeMatcherService => new ScopeMatcherService(),
    },
    {
      provide: RedisTokenBlacklistAdapter,
      useFactory: (redis: RedisClusterService): RedisTokenBlacklistAdapter =>
        new RedisTokenBlacklistAdapter(redis),
      inject: [RedisClusterService],
    },
    {
      provide: PrismaSecurityRoleRepository,
      useFactory: (prisma: PrismaService): PrismaSecurityRoleRepository =>
        new PrismaSecurityRoleRepository(prisma as never),
      inject: [PrismaService],
    },
    {
      provide: TokenScopeService,
      useFactory: (blacklist: RedisTokenBlacklistAdapter): TokenScopeService =>
        new TokenScopeService(blacklist),
      inject: [RedisTokenBlacklistAdapter],
    },
    {
      provide: BitwisePermissionGuard,
      useFactory: (
        reflector: Reflector,
        bitwise: BitwiseEvaluatorService,
        scopes: ScopeMatcherService,
        blacklist: RedisTokenBlacklistAdapter,
        audit: PrismaSecurityRoleRepository,
      ): BitwisePermissionGuard =>
        new BitwisePermissionGuard(reflector, bitwise, scopes, blacklist, audit),
      inject: [Reflector, BitwiseEvaluatorService, ScopeMatcherService, RedisTokenBlacklistAdapter, PrismaSecurityRoleRepository],
    },
    {
      provide: JwtScopeGuard,
      useFactory: (
        reflector: Reflector,
        scopes: ScopeMatcherService,
        blacklist: RedisTokenBlacklistAdapter,
      ): JwtScopeGuard => new JwtScopeGuard(reflector, scopes, blacklist),
      inject: [Reflector, ScopeMatcherService, RedisTokenBlacklistAdapter],
    },
    SecurityMatrixResolver,
  ],
  exports: [BitwiseEvaluatorService, ScopeMatcherService, TokenScopeService, PrismaSecurityRoleRepository],
})
export class SecurityMatrixModule {}
