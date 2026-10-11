// SSOT Phase 129 §5 — LINE compliance module wiring
// Canonical: apps/backend/src/modules/line-compliance/line-compliance.module.ts
// (legacy src/backend/modules/line-compliance/*)
// - useFactory wiring keeps services tsx-importable. RedisClusterService
//   arrives via global InfraModule; the audit logger rides the PdpaModule
//   provider (imported, not duplicated).
// - Zero new deps.
import { Module } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { PdpaModule } from '../pdpa/pdpa.module';
import { LineComplianceService } from './line-compliance.service';
import { LineWebhookController } from './line-webhook.controller';

@Module({
  imports: [PdpaModule],
  controllers: [LineWebhookController],
  providers: [
    {
      provide: LineComplianceService,
      useFactory: (redis: RedisClusterService) => new LineComplianceService(redis),
      inject: [RedisClusterService],
    },
  ],
  exports: [LineComplianceService],
})
export class LineComplianceModule {}
