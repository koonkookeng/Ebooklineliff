// SSOT Phase 123 Task 5 §5.2 — LINE Flex alert facade (storage budget lane)
// Canonical: apps/backend/src/modules/notification/services/line-flex-alert.service.ts
// (legacy src/backend/modules/notification/services/line-flex-alert.service.ts)
// - Thin facade over the storage-budget Flex builder: composes the bubble,
//   enforces the <10KB budget (builder throws oversize), and fans out via
//   the push port. The 019/024 messaging cores stay untouched — this is the
//   123-owned alert lane only.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { buildStorageBudgetFlex } from '../../storage/services/storage-budget.service';

/** Minimal LINE push surface (structural; 122 client satisfies it). */
export interface FlexAlertPushPort {
  push(lineUserId: string, message: unknown): Promise<{ messageId: string } | { queued: boolean }>;
}

@Injectable()
export class LineFlexAlertService {
  constructor(private readonly push: FlexAlertPushPort) {}

  /** Send a storage-budget Flex alert to every recipient (per-user errors). */
  async sendStorageBudgetAlert(params: {
    severity: 'WARNING' | 'CRITICAL';
    currentCost: number;
    budgetLimit: number;
    percentUsed: number;
    notifyLineUserIds: string[];
  }): Promise<Array<{ lineUserId: string; ok: boolean }>> {
    const flex = buildStorageBudgetFlex(params);
    const out: Array<{ lineUserId: string; ok: boolean }> = [];
    for (const lineUserId of params.notifyLineUserIds) {
      try {
        await this.push.push(lineUserId, flex);
        out.push({ lineUserId, ok: true });
      } catch {
        out.push({ lineUserId, ok: false });
      }
    }
    return out;
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { LineFlexAlertService as LineFlexAlertServiceService };
