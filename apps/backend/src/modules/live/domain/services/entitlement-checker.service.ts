// SSOT Phase 099 Task 3 — Live entitlement gatekeeper (≤50ms budget shape)
// Canonical: apps/backend/src/modules/live/domain/services/entitlement-checker.service.ts
// - Open sessions (no productId) join free; paywalled sessions require a
//   live, unexpired entitlement row (012 single-writer vocabulary).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';

export interface LiveEntitlementRow {
  accessGranted: boolean;
  expiresAt: Date | null;
}

export interface LiveGatePort {
  findEntitlement(userId: string, productId: string): Promise<LiveEntitlementRow | null>;
}

@Injectable()
export class EntitlementCheckerService {
  constructor(private readonly gate: LiveGatePort) {}

  async requireAccess(args: { userId: string; productId: string | null }): Promise<void> {
    if (!args.productId) return;
    const row = await this.gate.findEntitlement(args.userId, args.productId);
    if (!row?.accessGranted) {
      throw new Error('User lacks active entitlement for this Live Stream');
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new Error('User lacks active entitlement for this Live Stream');
    }
  }
}
