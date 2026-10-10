// SSOT Phase 115 — reconciliation notify port (swappable LINE OA sender)
// Canonical: apps/backend/src/modules/reconciliation/reconciliation-notify.service.ts
// - Default port records + streams the notice (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (085/111-114
//   precedent — receipts ride the 024 vocabulary via this handoff).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type ReconNotice = 'RECEIPT' | 'DISCREPANCY' | 'OVERRIDE_OK' | 'OVERRIDE_PENDING' | 'DUPLICATE';

export interface ReconciliationNotifyPort {
  sendNotice(lineUserId: string, notice: ReconNotice, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyReconciliationNotify implements ReconciliationNotifyPort {
  private readonly logger = new Logger(LogOnlyReconciliationNotify.name);

  async sendNotice(lineUserId: string, notice: ReconNotice, detail: string): Promise<{ messageId: string }> {
    const messageId = `rec-${Date.now().toString(36)}`;
    this.logger.log(`Reconciliation ${notice} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class ReconciliationNotificationService {
  constructor(private readonly port: LogOnlyReconciliationNotify) {}

  notify(lineUserId: string | null, notice: ReconNotice, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendNotice(lineUserId, notice, detail);
  }
}
