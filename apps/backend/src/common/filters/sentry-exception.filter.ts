// SSOT Phase 121 Task 2 §5.1/BDD-2 — global Sentry exception filter
// Canonical: apps/backend/src/common/filters/sentry-exception.filter.ts
// (legacy src/backend/common/filters/sentry-exception.filter.ts)
// - Catch-all: PII-scrubbed incident envelope + async SentryErrorIncident
//   persistence (best-effort — never breaks the error response, Gate 7) +
//   incident stream with a caller-facing reference id. Real @sentry/*
//   delivery swaps behind the port (documented seam, zero dep in repo).
// - Zero new deps.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { scrubPii } from '@repo/shared';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { currentTrace } from '../../infra/observability/trace-context.holder';

type LooseReq = Record<string, unknown>;
type LooseRes = {
  status: (code: number) => LooseRes;
  json: (body: unknown) => void;
};

export interface SentryPort {
  capture(envelope: Record<string, unknown>): Promise<{ sentryId: string }>;
}

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly port?: SentryPort,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<LooseReq>();
    const res = ctx.getResponse<LooseRes>();
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const trace = currentTrace();
    const sentryId = randomUUID();
    const referenceId = `INC-${Date.now().toString(36).toUpperCase()}`;

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawMessage = exception instanceof Error ? exception.message : 'Internal server error';
    const rawStack = exception instanceof Error ? exception.stack : undefined;
    const scrubbed = scrubPii({
      message: rawMessage,
      stack: rawStack,
      path: String(req['url'] ?? req['path'] ?? ''),
      method: String(req['method'] ?? ''),
    });

    const envelope = {
      sentryId,
      traceId: trace?.traceId ?? null,
      environment: process.env['NODE_ENV'] ?? 'development',
      serviceName: 'ebook-liff-backend',
      exceptionClass: exception instanceof Error ? exception.constructor.name : 'Unknown',
      errorMessage: (scrubbed as { message: string }).message,
      stackTrace: (scrubbed as { stack?: string }).stack ?? null,
      tenantId: trace?.tenantId ?? (headers['x-tenant-id'] ?? null),
      referenceId,
    };
    try {
      const sent = this.port ? await this.port.capture(envelope) : { sentryId };
      await (this.prisma as unknown as {
        sentryErrorIncident: { create(a: unknown): Promise<unknown> };
      }).sentryErrorIncident.create({
        data: {
          sentryId: sent.sentryId,
          traceId: envelope.traceId,
          environment: envelope.environment,
          serviceName: envelope.serviceName,
          exceptionClass: envelope.exceptionClass,
          errorMessage: envelope.errorMessage,
          ...(envelope.stackTrace ? { stackTrace: envelope.stackTrace } : {}),
          handled: false,
          tenantId: envelope.tenantId,
        },
      });
    } catch (err) {
      this.logger.warn(`Incident persistence fail-open for ${sentryId}: ${(err as Error).message}`);
    }
    try {
      await this.redis.xaddPipeline('stream:incidents', [{
        event: 'incident.captured',
        sentryId,
        referenceId,
        status,
        tenantId: envelope.tenantId ?? 'default',
        at: Date.now(),
      }]);
    } catch {
      // Telemetry never breaks error responses.
    }
    res.status(status).json({
      statusCode: status,
      // Never echo raw input: 4xx messages may quote caller-supplied PII.
      message: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal server error' : (scrubbed as { message: string }).message,
      incidentId: sentryId,
      referenceId,
    });
  }
}
