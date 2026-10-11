// SSOT Phase 122 Task 5 §5.1 — EasySlip circuit adapter (BDD-2 fallback)
// Canonical: apps/backend/src/modules/resilience/adapters/easyslip-circuit.adapter.ts
// (legacy src/backend/modules/resilience/adapters/easyslip-circuit.adapter.ts)
// - Wraps any EasySlip verify port behind the 'easyslip' breaker: OPEN or
//   fault/timeout → queued-for-review fallback (Thai LIFF copy per §2.1)
//   so slip intake never drops while the vendor is down. The payment core
//   (014/015 lanes) stays untouched — this adapter is the only seam.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CircuitBreakerService } from '../services/circuit-breaker.service';

/** Minimal EasySlip verify surface (structural; existing providers satisfy it). */
export interface EasySlipVerifyPort {
  verify(slipUrl: string): Promise<{ transRef: string; amount: number; receiverAccount: string }>;
}

export interface EasySlipQueuedResult {
  queued: true;
  transRef: string;
  fallback: 'CIRCUIT_OPEN_EASYSLIP';
  message: string;
}

export const EASYSLIP_FALLBACK_MESSAGE =
  'ระบบตรวจสลิปอัตโนมัติกำลังปรับปรุงชั่วคราว ทีมงานกำลังรับสลิปของท่านเข้าคิวตรวจสอบแบบเรียลไทม์ สินค้าดิจิทัลจะเปิดสิทธิ์ให้อัตโนมัติในทันที';

@Injectable()
export class EasySlipCircuitAdapter {
  constructor(
    private readonly breaker: CircuitBreakerService,
    private readonly inner: EasySlipVerifyPort,
  ) {}

  /** Verify behind the breaker (fallback = queued review, never a throw). */
  verify(
    slipUrl: string,
    traceRef = 'unknown',
  ): Promise<{ transRef: string; amount: number; receiverAccount: string } | EasySlipQueuedResult> {
    return this.breaker.executeWithCircuitBreaker<
      { transRef: string; amount: number; receiverAccount: string } | EasySlipQueuedResult
    >(
      'easyslip',
      () => this.inner.verify(slipUrl),
      async () => ({
        queued: true as const,
        transRef: `QUEUED-${traceRef}`,
        fallback: 'CIRCUIT_OPEN_EASYSLIP' as const,
        message: EASYSLIP_FALLBACK_MESSAGE,
      }),
    );
  }
}
