// SSOT Phase 119 — device notify port (swappable LINE OA sender)
// Canonical: apps/backend/src/modules/security/device-notify.service.ts
// - Default port records + streams the notice (synthetic id). Swap the
//   provider to a LINE OA sender without touching callers (085/111-118
//   precedent).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';

export type DeviceNotice = 'EVICTED' | 'FRAUD_LOCK';

export interface DeviceNotifyPort {
  sendNotice(lineUserId: string, notice: DeviceNotice, detail: string): Promise<{ messageId: string }>;
}

@Injectable()
export class LogOnlyDeviceNotify implements DeviceNotifyPort {
  private readonly logger = new Logger(LogOnlyDeviceNotify.name);

  async sendNotice(lineUserId: string, notice: DeviceNotice, detail: string): Promise<{ messageId: string }> {
    const messageId = `dev-${Date.now().toString(36)}`;
    this.logger.log(`Device ${notice} for ${lineUserId}: ${detail.slice(0, 64)}`);
    return { messageId };
  }
}

@Injectable()
export class DeviceNotificationService {
  constructor(private readonly port: LogOnlyDeviceNotify) {}

  notify(lineUserId: string | null, notice: DeviceNotice, detail: string): Promise<{ messageId: string } | null> {
    if (!lineUserId) return Promise.resolve(null);
    return this.port.sendNotice(lineUserId, notice, detail);
  }
}
