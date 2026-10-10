// SSOT Phase 118 — audit notify port (swappable LINE OA sender)
// Canonical: apps/backend/src/modules/audit-log/application/audit-notify.service.ts
// - Default port records + streams the notice (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (085/111-117
//   precedent).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type AuditNotice = 'TAMPER_DETECTED' | 'CHAIN_VERIFIED';

export interface AuditNotifyPort {
  sendNotice(lineUserId: string, notice: AuditNotice, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyAuditNotify implements AuditNotifyPort {
  private readonly logger = new Logger(LogOnlyAuditNotify.name);

  async sendNotice(lineUserId: string, notice: AuditNotice, detail: string): Promise<{ messageId: string }> {
    const messageId = `adt-${Date.now().toString(36)}`;
    this.logger.log(`Audit ${notice} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class AuditNotificationService {
  constructor(private readonly port: LogOnlyAuditNotify) {}

  notify(lineUserId: string | null, notice: AuditNotice, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendNotice(lineUserId, notice, detail);
  }
}
