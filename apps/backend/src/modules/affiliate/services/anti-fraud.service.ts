// SSOT Phase 079 Task 5 — Anti-fraud screen (self/device/velocity)
// Canonical: apps/backend/src/modules/affiliate/services/anti-fraud.service.ts
// - screenOrder: SELF_REFERRAL (buyer == beneficiary / same lineUserId),
//   DEVICE_REUSE (buyer fingerprint == referrer fingerprint), VELOCITY
//   (>5 paid orders from one fingerprint in 10 min). Hits emit to the fraud
//   stream (BDD-3) and the caller writes BLOCKED_FRAUD logs.
// - Port-based (fingerprint/velocity stores) for DB-free tests.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { AFFILIATE_FRAUD_STREAM } from '@repo/shared';

export interface FraudSignal {
  buyerUserId: string;
  buyerLineUserId: string | null;
  buyerFingerprint: string | null;
  ancestors: Array<{ id: string; lineUserId: string | null; fingerprint: string | null }>;
}

export interface FraudVerdict {
  clean: boolean;
  reason: string | null;
}

export interface FraudBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface VelocityStore {
  /** Count + bump buyer events in the window; returns the new count. */
  bump(key: string, windowSec: number): Promise<number>;
}

@Injectable()
export class AntiFraudService {
  constructor(
    private readonly bus: FraudBus,
    private readonly velocity: VelocityStore,
  ) {}

  async screenOrder(orderId: string, signal: FraudSignal): Promise<FraudVerdict> {
    // 1. Self-referral: same user or same LINE account anywhere up-chain.
    for (const a of signal.ancestors) {
      if (a.id === signal.buyerUserId) return this.block(orderId, 'SELF_REFERRAL_BLOCKED');
      if (signal.buyerLineUserId && a.lineUserId === signal.buyerLineUserId) {
        return this.block(orderId, 'SELF_REFERRAL_BLOCKED');
      }
    }
    // 2. Device reuse: buyer fingerprint matches a referrer fingerprint.
    if (signal.buyerFingerprint) {
      for (const a of signal.ancestors) {
        if (a.fingerprint && a.fingerprint === signal.buyerFingerprint) {
          return this.block(orderId, 'DEVICE_REUSE_BLOCKED');
        }
      }
      // 3. Velocity: >5 paid orders / fingerprint / 10 min.
      const n = await this.velocity.bump(`affiliate:velocity:${signal.buyerFingerprint}`, 600);
      if (n > 5) return this.block(orderId, 'VELOCITY_BLOCKED');
    }
    return { clean: true, reason: null };
  }

  private async block(orderId: string, reason: string): Promise<FraudVerdict> {
    await this.bus
      .xadd(AFFILIATE_FRAUD_STREAM, { event: 'affiliate.fraud.blocked', orderId, reason, at: Date.now() })
      .catch(() => undefined);
    return { clean: false, reason };
  }
}
