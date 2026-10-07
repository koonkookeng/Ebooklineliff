// SSOT Phase 035 Task 2 — Memory/performance checker (BDD Scenario 1)
// Canonical: apps/backend/src/modules/line-sandbox/checkers/memory-performance.checker.ts
// (legacy src/backend/modules/line-sandbox/checkers/memory-performance.checker.ts)
// - MEMORY_PERFORMANCE: heap strictly < 30MB + blob URLs revoked (missing
//   signals fail closed — an unmeasured client cannot claim PASS, Gate 5).
// - Zero new deps.
import { SANDBOX_RAM_LIMIT_MB, type SandboxSignals } from '@repo/shared';
import type { CheckerResult } from './checker.types';

export function checkMemoryPerformance(signals: SandboxSignals): CheckerResult[] {
  const heap = signals.heapUsedMB;
  const heapPassed = typeof heap === 'number' && heap < SANDBOX_RAM_LIMIT_MB;
  const revokedPassed = signals.blobUrlsRevoked === true;
  return [
    {
      category: 'MEMORY_PERFORMANCE',
      checkPointName: 'Canvas heap strictly under 30MB after 50-page walk',
      isPassed: heapPassed,
      memoryUsageMB: typeof heap === 'number' ? heap : 0,
      ...(heapPassed ? {} : { diagnosticMessage: `Heap ${heap ?? 'unmeasured'}MB — GC chunks / revoke blob URLs` }),
    },
    {
      category: 'MEMORY_PERFORMANCE',
      checkPointName: 'Unused Blob Object URLs revoked (GC N-2)',
      isPassed: revokedPassed,
      memoryUsageMB: typeof heap === 'number' ? heap : 0,
      ...(revokedPassed ? {} : { diagnosticMessage: 'Confirm URL.revokeObjectURL sweep on hidden/page change' }),
    },
  ];
}
