// SSOT Phase 122 Task 5 §5.1 — LINE messaging circuit adapter (BDD-2 fallback)
// Canonical: apps/backend/src/modules/resilience/adapters/line-circuit.adapter.ts
// - Wraps any LINE push port behind the 'line-messaging' breaker: OPEN or
//   fault/timeout → queued fallback (Thai LIFF copy per §2.1) so order
//   history stays authoritative while chat delivery lags. The 019/024
//   messaging core stays untouched — this adapter is the only seam.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CircuitBreakerService } from '../services/circuit-breaker.service';

/** Minimal LINE push surface (structural; existing services satisfy it). */
export interface LinePushPort {
  push(lineUserId: string, message: unknown): Promise<{ messageId: string }>;
}

export interface LineQueuedResult {
  queued: true;
  fallback: 'CIRCUIT_OPEN_LINE_MSG';
  message: string;
}

export const LINE_FALLBACK_MESSAGE =
  'การส่งข้อความยืนยันใน LINE แชตอาจล่าช้าเล็กน้อย ท่านสามารถตรวจสอบคำสั่งซื้อได้ทันทีในประวัติการสั่งซื้อ';

@Injectable()
export class LineCircuitAdapter {
  constructor(
    private readonly breaker: CircuitBreakerService,
    private readonly inner: LinePushPort,
  ) {}

  /** Push behind the breaker (fallback = queued, never a throw). */
  push(lineUserId: string, message: unknown): Promise<{ messageId: string } | LineQueuedResult> {
    return this.breaker.executeWithCircuitBreaker<{ messageId: string } | LineQueuedResult>(
      'line-messaging',
      () => this.inner.push(lineUserId, message),
      async () => ({
        queued: true as const,
        fallback: 'CIRCUIT_OPEN_LINE_MSG' as const,
        message: LINE_FALLBACK_MESSAGE,
      }),
      { failureThresholdPercentage: 50, minimumNumberOfCalls: 10, slidingWindowSize: 20 },
    );
  }
}
