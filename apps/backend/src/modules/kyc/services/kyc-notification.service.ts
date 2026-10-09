// SSOT Phase 085 Task 8 — KYC Flex notify (swappable delivery port)
// Canonical: apps/backend/src/modules/kyc/services/kyc-notification.service.ts
// - Default port records + streams the decision (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (084 precedent —
//   no tenant template exists in the 024 vocabulary for KYC verdicts).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { KycQueueService } from './kyc-queue.service';

export interface KycNotifyPort {
  sendVerdict(lineUserId: string, verdict: 'VERIFIED' | 'REJECTED' | 'ACTION_REQUIRED', detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyKycNotify implements KycNotifyPort {
  private readonly logger = new Logger(LogOnlyKycNotify.name);

  constructor(private readonly queue: KycQueueService) {}

  async sendVerdict(lineUserId: string, verdict: 'VERIFIED' | 'REJECTED' | 'ACTION_REQUIRED', detail: string): Promise<{ messageId: string }> {
    const messageId = `kyc-${Date.now().toString(36)}`;
    this.logger.log(`KYC ${verdict} for ${lineUserId}: ${detail.slice(0, 64)}`);
    await this.queue.publish('kyc.verdict.queued', { lineUserId, verdict, messageId });
    return { messageId };
  }
}

@Injectable()
export class KycNotificationService {
  constructor(private readonly port: LogOnlyKycNotify) {}

  notify(lineUserId: string | null, verdict: 'VERIFIED' | 'REJECTED' | 'ACTION_REQUIRED', detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendVerdict(lineUserId, verdict, detail);
  }
}
