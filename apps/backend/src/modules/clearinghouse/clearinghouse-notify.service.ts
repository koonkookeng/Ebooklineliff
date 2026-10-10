// SSOT Phase 114 Task 6 — clearinghouse notify port (swappable LINE sender)
// Canonical: apps/backend/src/modules/clearinghouse/clearinghouse-notify.service.ts
// - Default port records + streams notices (synthetic id). Swap the provider
//   to a LINE OA sender without touching callers (085/111-113 precedent).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type ClearinghouseNotice = 'SETTLED' | 'PAYOUT_EXECUTING' | 'DISCREPANCY_HOLD';

export interface ClearinghouseNotifyPort {
  sendNotice(lineUserId: string, notice: ClearinghouseNotice, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyClearinghouseNotify implements ClearinghouseNotifyPort {
  private readonly logger = new Logger(LogOnlyClearinghouseNotify.name);

  async sendNotice(lineUserId: string, notice: ClearinghouseNotice, detail: string): Promise<{ messageId: string }> {
    const messageId = `clr-${Date.now().toString(36)}`;
    this.logger.log(`Clearinghouse ${notice} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class ClearinghouseNotificationService {
  constructor(private readonly port: LogOnlyClearinghouseNotify) {}

  notify(lineUserId: string | null, notice: ClearinghouseNotice, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendNotice(lineUserId, notice, detail);
  }
}
