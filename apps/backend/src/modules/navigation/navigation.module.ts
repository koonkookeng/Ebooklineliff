// SSOT Phase 027 §5.1 — Navigation module
// Canonical: apps/backend/src/modules/navigation/navigation.module.ts
// (legacy src/backend/modules/navigation/navigation.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { NavigationService } from './navigation.service';
import { NavigationController } from './navigation.controller';
import { NavigationResolver } from './navigation.resolver';
import { LiffSessionGuard } from './guards/liff-session.guard';

@Module({
  controllers: [NavigationController],
  providers: [NavigationService, NavigationResolver, LiffSessionGuard],
  exports: [NavigationService],
})
export class NavigationModule {}
