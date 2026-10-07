// SSOT Phase 035 §5.1 — LINE sandbox module (audit runner + verification)
// Canonical: apps/backend/src/modules/line-sandbox/line-sandbox.module.ts
// (legacy src/backend/modules/line-sandbox/line-sandbox.module.ts)
// NOTE: PrismaService + RedisClusterService come from global InfraModule (single pool).
import { Module } from '@nestjs/common';
import { LineSandboxRunnerService } from './services/line-sandbox-runner.service';
import { LineReviewVerifierService } from './services/line-review-verifier.service';
import { LineSandboxAuditController } from './controllers/line-sandbox-audit.controller';

@Module({
  controllers: [LineSandboxAuditController],
  providers: [LineSandboxRunnerService, LineReviewVerifierService],
  exports: [LineSandboxRunnerService, LineReviewVerifierService],
})
export class LineSandboxModule {}
