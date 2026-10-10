// SSOT Phase 112 Task 8 — moderation notify port (swappable LINE OA sender)
// Canonical: apps/backend/src/modules/moderation/services/moderation-notify.service.ts
// - Default port records + streams the verdict (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (085/111 precedent —
//   no tenant template exists in the 024 vocabulary for moderation verdicts).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type ModerationVerdict = 'PASSED' | 'QUARANTINED' | 'APPEAL_PENDING' | 'APPROVED' | 'REJECTED';

export interface ModerationNotifyPort {
  sendVerdict(lineUserId: string, verdict: ModerationVerdict, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyModerationNotify implements ModerationNotifyPort {
  private readonly logger = new Logger(LogOnlyModerationNotify.name);

  async sendVerdict(lineUserId: string, verdict: ModerationVerdict, detail: string): Promise<{ messageId: string }> {
    const messageId = `mod-${Date.now().toString(36)}`;
    this.logger.log(`Moderation ${verdict} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class ModerationNotificationService {
  constructor(private readonly port: LogOnlyModerationNotify) {}

  notify(lineUserId: string | null, verdict: ModerationVerdict, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendVerdict(lineUserId, verdict, detail);
  }
}
