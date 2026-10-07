// SSOT Phase 028 §7.2 — framework-free CSP report ingestor (unit-testable core)
// Canonical: apps/backend/src/infra/security/csp-report.handler.ts
// - Thin-controller pattern (Phase 015/017 precedent): all logic here, the
//   Nest controller only extracts transport metadata (ip/ua) and answers 204.
// - Returns { stored: false } for unusable bodies (endpoint still 204s).
// - Sinks never throw: Redis fail-open + Prisma catch-and-log (Gate 7 <10ms).
import {
  CSP_QUEUE,
  classifyCspSeverity,
  normalizeCspReport,
  type SecuritySeverity,
} from '@repo/shared';

export interface CspReportMeta {
  ipAddress: string;
  userAgent: string;
}

interface PublishSink {
  publish: (channel: string, message: string) => Promise<unknown>;
}

interface CreateSink {
  securityCspLog: { create: (args: unknown) => Promise<unknown> };
}

export interface CspIngestDeps {
  redis: PublishSink;
  prisma: CreateSink;
  warn?: (message: string) => void;
}

export interface CspIngestResult {
  stored: boolean;
  severity?: SecuritySeverity;
}

export async function ingestCspReport(
  deps: CspIngestDeps,
  body: unknown,
  meta: CspReportMeta,
): Promise<CspIngestResult> {
  const record = normalizeCspReport(body);
  if (!record) return { stored: false };
  const severity = classifyCspSeverity(record);

  await deps.redis
    .publish(
      CSP_QUEUE,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        documentUri: record.documentUri,
        violatedDirective: record.violatedDirective,
        blockedUri: record.blockedUri,
        severity,
        ipAddress: meta.ipAddress,
      }),
    )
    .catch((err: unknown) => {
      deps.warn?.(`CSP queue publish failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });

  await deps.prisma.securityCspLog
    .create({
      data: {
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        documentUri: record.documentUri,
        violatedDirective: record.violatedDirective,
        blockedUri: record.blockedUri,
        originalPolicy: record.originalPolicy,
        severity,
      },
    })
    .catch((err: unknown) => {
      deps.warn?.(`CSP audit write failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });

  return { stored: true, severity };
}
