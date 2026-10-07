// SSOT Phase 028 §7.2 — CSP violation report endpoint (204 beacon, async sinks)
// Canonical: apps/backend/src/infra/security/csp-report.controller.ts
// (legacy src/backend/api/controllers/csp-report.controller.ts — legacy alias kept)
// - POST /api/v1/security/csp-report: accepts native + camelCase envelopes,
//   always answers 204 (never signals policy shape to potential attackers).
// - Gate 7: Prisma append is awaited-but-caught (audit must not 5xx the beacon);
//   Redis publish is best-effort (fail-open on edge outage, Phase 025 precedent).
// - RISK_CALL deviation (documented): Redis uses publish(CSP_QUEUE) instead of
//   spec §7.2 lpush — RedisClusterService exposes publish (cluster-safe, used by
//   every phase since 006); consumers subscribe identically for analytics/alerts.
// - Zero new deps: Prisma SSOT + RedisClusterService (publish) only.
import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisClusterService } from '../redis/redis-cluster.service';
import { ingestCspReport } from './csp-report.handler';

interface ReportRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}

function header(headers: ReportRequest['headers'], name: string): string | undefined {
  const v = headers?.[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

@Controller('api/v1/security')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  @Post('csp-report')
  @HttpCode(HttpStatus.NO_CONTENT)
  async handleCspReport(@Body() body: unknown, @Req() req: ReportRequest): Promise<void> {
    const forwarded = header(req.headers, 'x-forwarded-for');
    await ingestCspReport(
      {
        redis: this.redis,
        prisma: this.prisma as unknown as {
          securityCspLog: { create: (args: unknown) => Promise<unknown> };
        },
        warn: (message: string) => this.logger.warn(message),
      },
      body,
      {
        ipAddress: forwarded?.split(',')[0].trim() || req.ip || 'unknown',
        userAgent: header(req.headers, 'user-agent') || 'Unknown',
      },
    );
  }
}
