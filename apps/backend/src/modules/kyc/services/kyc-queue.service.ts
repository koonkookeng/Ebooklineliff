// SSOT Phase 085 Task 7 — KYC queue service (stream handoff, no BullMQ pkg)
// Canonical: apps/backend/src/modules/kyc/services/kyc-queue.service.ts
// - RISK_CALL: no BullMQ package (zero-dep rule, 026–084 precedent) —
//   SUBMIT/OCR/DECIDE events ride the Redis stream; workers drain it.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { KYC_EVENT_STREAM } from '@repo/shared';

@Injectable()
export class KycQueueService {
  constructor(private readonly redis: RedisClusterService) {}

  async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(KYC_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks KYC flows.
    }
  }
}
