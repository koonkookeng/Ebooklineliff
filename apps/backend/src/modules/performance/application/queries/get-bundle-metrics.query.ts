// SSOT Phase 029 §5.1 — Get-bundle-metrics query (CQRS-lite read path)
// Canonical: apps/backend/src/modules/performance/application/queries/get-bundle-metrics.query.ts
// (legacy src/backend/modules/performance/.../get-bundle-metrics.query.ts)
// - Thin delegation to BundleGuardService.latest() (single-row indexed read).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { BundleGuardService, type BundleGuardResult } from '../services/bundle-guard.service';

@Injectable()
export class GetBundleMetricsQuery {
  constructor(private readonly guard: BundleGuardService) {}

  execute(): Promise<BundleGuardResult | null> {
    return this.guard.latest();
  }
}
