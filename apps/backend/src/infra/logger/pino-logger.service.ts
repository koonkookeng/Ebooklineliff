// SSOT Phase 121 Task 3 §5.1 — centralized structured JSON logger
// Canonical: apps/backend/src/infra/logger/pino-logger.service.ts
// (legacy src/backend/infra/logger/pino-logger.service.ts)
// - Pino-compatible JSON lines (a real pino instance swaps behind emit()
//   without touching callers — documented seam, zero dep in repo): level,
//   time, service, trace_id/span_id (ALS-injected), tenant/user, action,
//   message, scrubbed context, optional error.
// - Every payload is PII-scrubbed pre-emit (Gate 4). Emitters never throw.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { StructuredLogPayloadSchema, scrubPii, type TelemetryLogLevel } from '@repo/shared';
import { currentTrace } from '../observability/trace-context.holder';
import { redactPii } from './redact-pii.utility';

export interface LogFields {
  action: string;
  message: string;
  context?: unknown;
  error?: { name: string; message: string; stack?: string };
  tenantId?: string;
  userId?: string;
}

@Injectable()
export class PinoLoggerService {
  private readonly logger = new Logger('json');
  private readonly serviceName: string;

  constructor(serviceName = 'ebook-liff-backend') {
    this.serviceName = serviceName;
  }

  private emit(level: TelemetryLogLevel, fields: LogFields): Record<string, unknown> {
    const trace = currentTrace();
    const payload = {
      traceId: trace?.traceId ?? 'no-trace',
      spanId: trace?.spanId ?? 'no-span',
      timestamp: new Date().toISOString(),
      level,
      serviceName: this.serviceName,
      tenantId: fields.tenantId ?? trace?.tenantId,
      userId: fields.userId ?? trace?.userId,
      action: fields.action,
      message: fields.message,
      context: fields.context ?? {},
      ...(fields.error ? { error: fields.error } : {}),
    };
    const parsed = StructuredLogPayloadSchema.safeParse(payload);
    const line = redactPii(parsed.success ? parsed.data : { ...payload, level: 'ERROR' as const });
    const text = JSON.stringify(line);
    switch (level) {
      case 'TRACE':
      case 'DEBUG':
        this.logger.debug(text);
        break;
      case 'INFO':
        this.logger.log(text);
        break;
      case 'WARN':
        this.logger.warn(text);
        break;
      case 'ERROR':
      case 'FATAL':
        this.logger.error(text);
        break;
    }
    return line as unknown as Record<string, unknown>;
  }

  trace(action: string, message: string, context?: unknown): Record<string, unknown> {
    return this.emit('TRACE', { action, message, context });
  }

  debug(action: string, message: string, context?: unknown): Record<string, unknown> {
    return this.emit('DEBUG', { action, message, context });
  }

  info(action: string, message: string, context?: unknown): Record<string, unknown> {
    return this.emit('INFO', { action, message, context });
  }

  warn(action: string, message: string, context?: unknown): Record<string, unknown> {
    return this.emit('WARN', { action, message, context });
  }

  error(action: string, message: string, error?: Error, context?: unknown): Record<string, unknown> {
    return this.emit('ERROR', {
      action,
      message,
      context,
      ...(error ? { error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) } } : {}),
    });
  }

  fatal(action: string, message: string, error?: Error, context?: unknown): Record<string, unknown> {
    return this.emit('FATAL', {
      action,
      message,
      context,
      ...(error ? { error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) } } : {}),
    });
  }
}
