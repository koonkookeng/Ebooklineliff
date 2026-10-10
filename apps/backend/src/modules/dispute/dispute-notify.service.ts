// SSOT Phase 113 Task 8 — dispute notify port (swappable LINE OA sender)
// Canonical: apps/backend/src/modules/dispute/dispute-notify.service.ts
// - Default port records + streams the notice (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (085/111/112
//   precedent — no tenant template exists in the 024 vocabulary for
//   dispute/escrow notices).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type DisputeNotice = 'FILED' | 'SELLER_RESPONSE' | 'REFUND_APPROVED' | 'RELEASED_SELLER' | 'CANCELLED' | 'ESCROW_RELEASED';

export interface DisputeNotifyPort {
  sendNotice(lineUserId: string, notice: DisputeNotice, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyDisputeNotify implements DisputeNotifyPort {
  private readonly logger = new Logger(LogOnlyDisputeNotify.name);

  async sendNotice(lineUserId: string, notice: DisputeNotice, detail: string): Promise<{ messageId: string }> {
    const messageId = `dsp-${Date.now().toString(36)}`;
    this.logger.log(`Dispute ${notice} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class DisputeNotificationService {
  constructor(private readonly port: LogOnlyDisputeNotify) {}

  notify(lineUserId: string | null, notice: DisputeNotice, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendNotice(lineUserId, notice, detail);
  }
}
