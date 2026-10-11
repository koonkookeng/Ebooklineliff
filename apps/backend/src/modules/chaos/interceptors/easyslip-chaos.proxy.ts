// SSOT Phase 124 Task 2 §5.2 — EasySlip chaos proxy (BDD-2 composition)
// Canonical: apps/backend/src/modules/chaos/interceptors/easyslip-chaos.proxy.ts
// (legacy src/backend/modules/chaos/interceptors/easyslip-chaos.proxy.ts)
// - Wraps an EasySlip verify port: EASYSLIP_TIMEOUT injects the 5s chaos
//   latency (122 breaker times out at 1s → fallback → outbox, exactly the
//   BDD-2 path); EASYSLIP_500_ERROR throws a vendor-500 immediately.
//   Composes OUTSIDE the 122 circuit adapter (chaos → breaker → vendor).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CHAOS_EASYSLIP_LATENCY_MS } from '@repo/shared';
import { ChaosInjectorService } from '../chaos-injector.service';

export interface ChaosEasySlipPort {
  verify(slipUrl: string): Promise<{ transRef: string; amount: number; receiverAccount: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class EasySlipChaosProxy implements ChaosEasySlipPort {
  constructor(
    private readonly chaos: ChaosInjectorService,
    private readonly inner: ChaosEasySlipPort,
    private readonly targetService = 'easyslip',
  ) {}

  async verify(slipUrl: string): Promise<{ transRef: string; amount: number; receiverAccount: string }> {
    if (await this.chaos.isFaultActive(this.targetService, 'EASYSLIP_500_ERROR')) {
      throw new Error('EASYSLIP_HTTP_500 (chaos-injected)');
    }
    if (await this.chaos.isFaultActive(this.targetService, 'EASYSLIP_TIMEOUT')) {
      await sleep(CHAOS_EASYSLIP_LATENCY_MS);
    }
    return this.inner.verify(slipUrl);
  }
}
