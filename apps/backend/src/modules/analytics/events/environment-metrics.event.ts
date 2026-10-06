// SSOT Phase 022 §5.1 + §7.1 — Environment metrics event + analytics service
// Canonical: apps/backend/src/modules/analytics/events/environment-metrics.event.ts
// (legacy src/backend/modules/analytics/events/environment-metrics.event.ts)
// - Fire-and-forget persistence: async background write, never blocks UI (Gate 7).
// - Zero new deps: NestJS + Prisma SSOT only. No PII in logs (userAgent truncated).
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  SyncEnvironmentPayloadSchema,
  type SyncEnvironmentPayload,
  type LayoutMode,
} from '@repo/shared';

export const UI_LAYOUT_OBSCURED_POTENTIAL = 'UI_LAYOUT_OBSCURED_POTENTIAL';

export interface EnvironmentMetricResult {
  success: boolean;
  recommendedLayoutMode: LayoutMode;
}

function layoutModeFor(environment: SyncEnvironmentPayload['metrics']['environment']): LayoutMode {
  if (environment === 'LINE_LIFF_IOS' || environment === 'LINE_LIFF_ANDROID') return 'LIFF_EMBEDDED_COMPACT';
  if (environment === 'IN_APP_WEBVIEW') return 'WEBVIEW_FULLSCREEN_SAFE';
  return 'STANDARD_WEB';
}

@Injectable()
export class EnvironmentAnalyticsService {
  private readonly logger = new Logger(EnvironmentAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processAndRecordMetrics(payload: SyncEnvironmentPayload): Promise<EnvironmentMetricResult> {
    const parsed = SyncEnvironmentPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn('Invalid environment metrics payload rejected');
      return { success: false, recommendedLayoutMode: 'STANDARD_WEB' };
    }
    const { userId, tenantId, metrics, userAgent } = parsed.data;

    // Async background persist (Gate 7) — response never waits for the write.
    void this.prisma.userDeviceMetric
      .create({
        data: {
          userId: userId ?? null,
          tenantId,
          environment: metrics.environment,
          viewportWidth: Math.round(metrics.windowWidth),
          viewportHeight: Math.round(metrics.windowHeight),
          safeAreaTop: metrics.safeArea.top,
          safeAreaBottom: metrics.safeArea.bottom,
          safeAreaLeft: metrics.safeArea.left,
          safeAreaRight: metrics.safeArea.right,
          devicePixelRatio: metrics.devicePixelRatio,
          userAgent,
        },
      })
      .catch((err: unknown) => {
        this.logger.error(`Failed to record device metric: ${err instanceof Error ? err.message : 'unknown'}`);
      });

    // §7.1 obscurity signal: touch device, small screen, zero bottom inset
    if (metrics.isTouchDevice && metrics.windowWidth < 768 && metrics.safeArea.bottom === 0) {
      this.logger.warn(`${UI_LAYOUT_OBSCURED_POTENTIAL} tenant=${tenantId} env=${metrics.environment}`);
    }

    return { success: true, recommendedLayoutMode: layoutModeFor(metrics.environment) };
  }
}
