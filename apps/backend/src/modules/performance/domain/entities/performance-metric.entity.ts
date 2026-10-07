// SSOT Phase 029 §5.1 — PerformanceMetric entity (RUM/telemetry invariants)
// Canonical: apps/backend/src/modules/performance/domain/entities/performance-metric.entity.ts
// (legacy src/backend/modules/performance/domain/entities/performance-metric.entity.ts)
// - Guards the hot write path: finite non-negative values, rooted routes, known
//   metric vocabulary (Zod-checked at the boundary; entity double-guards).
// - Zero new deps.
import { PerformanceMetricTypeEnum, type PerformanceMetricType } from '@repo/shared';

export interface PerformanceMetricProps {
  tenantId: string;
  metricType: PerformanceMetricType;
  metricValue: number;
  route: string;
  deviceMemory?: number;
  effectiveType?: string;
  userAgent?: string;
}

export class PerformanceMetric {
  private constructor(readonly props: PerformanceMetricProps) {}

  static create(props: PerformanceMetricProps): PerformanceMetric {
    if (!props.tenantId) throw new Error('Missing tenant id');
    if (!PerformanceMetricTypeEnum.options.includes(props.metricType)) throw new Error('Unknown metric type');
    if (!Number.isFinite(props.metricValue) || props.metricValue < 0) throw new Error('Invalid metric value');
    if (!props.route.startsWith('/')) throw new Error('Route must be rooted');
    return new PerformanceMetric(props);
  }
}
