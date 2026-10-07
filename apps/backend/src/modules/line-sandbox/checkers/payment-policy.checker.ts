// SSOT Phase 035 Task 2 — Payment/DRM policy checkers (external-policy gate)
// Canonical: apps/backend/src/modules/line-sandbox/checkers/payment-policy.checker.ts
// (legacy src/backend/modules/line-sandbox/checkers/payment-policy.checker.ts)
// - PAYMENT_EXTERNAL_POLICY: no external IAP cut (PromptPay zero-fee rail).
// - MEDIA_STREAMING_DRM: R2/edge delivery + forensic watermark enabled.
// - Missing signals fail closed (Gate 6).
// - Zero new deps.
import type { SandboxSignals } from '@repo/shared';
import type { CheckerResult } from './checker.types';

export function checkPaymentPolicy(signals: SandboxSignals): CheckerResult[] {
  const noIap = signals.usesExternalIAP === false;
  const zeroFee = signals.promptPayZeroFee === true;
  const r2edge = signals.mediaViaR2Edge === true;
  const watermark = signals.watermarkEnabled === true;
  return [
    {
      category: 'PAYMENT_EXTERNAL_POLICY',
      checkPointName: 'Zero-fee PromptPay rail, no external IAP cut',
      isPassed: noIap && zeroFee,
      memoryUsageMB: 0,
      ...(noIap && zeroFee ? {} : { diagnosticMessage: 'Route digital payments via PromptPay slip rail (0% platform cut)' }),
    },
    {
      category: 'MEDIA_STREAMING_DRM',
      checkPointName: 'R2/edge delivery with forensic watermark overlay',
      isPassed: r2edge && watermark,
      memoryUsageMB: 0,
      ...(r2edge && watermark ? {} : { diagnosticMessage: 'Serve chunks via R2 edge with dynamic watermark enabled' }),
    },
  ];
}
