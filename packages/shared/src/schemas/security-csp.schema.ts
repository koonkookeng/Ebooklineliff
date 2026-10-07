// SSOT Phase 028 §3.1 — CSP + LINE domain-whitelist Zod SSOT contract
// Canonical: packages/shared/src/schemas/security-csp.schema.ts
// (legacy src/shared/schemas/security-csp.schema.ts)
// - Spec-verbatim: CspReportPayload / DomainWhitelistConfig / HlsStreamTokenPayload.
// - RISK_CALL deviations (documented, additive-only):
//   - Native browser reports use hyphenated keys (`document-uri`, `violated-directive`)
//     and non-URL blocked values (`inline`, `data:`, `blob:`, `eval`); the strict
//     spec-camelCase schema would 400 every real browser report. Accept BOTH via
//     NativeCspReportSchema + CspReportPayloadSchema union, then normalizeCspReport().
//   - tenantId is z.string().min(1), not uuid: tenant hints flow as opaque slugs
//     ('default') at the edge (Phase 023/024/025/026/027 precedent).
//   - videoId/tenantId follow the same opaque-string rule for dev/seed flows.
// - Zero new deps (zod only). buildCspHeader() is the single directive source for
//   the Nest middleware; the Next edge copy (apps/frontend/lib/security/csp-header.ts)
//   is byte-parity tested against it (edge bundle stays zod-free, Gate 5).
import { z } from 'zod';

export const CspDispositionEnum = z.enum(['enforce', 'report']);
export type CspDisposition = z.infer<typeof CspDispositionEnum>;

/** Native browser `csp-report` payload (hyphenated keys, CSP Level 3). */
export const NativeCspReportSchema = z.object({
  'document-uri': z.string().min(1),
  referrer: z.string().optional(),
  'violated-directive': z.string().min(1),
  'effective-directive': z.string().min(1).optional(),
  'original-policy': z.string().min(1),
  disposition: CspDispositionEnum.default('enforce'),
  'blocked-uri': z.string().min(1),
  'status-code': z.number().int().default(0),
  'script-sample': z.string().max(500).optional(),
  'source-file': z.string().optional(),
  'line-number': z.number().int().optional(),
});
export type NativeCspReport = z.infer<typeof NativeCspReportSchema>;

const NativeEnvelopeSchema = z.object({ 'csp-report': NativeCspReportSchema });

/** Spec §3.1 camelCase report shape (server-to-server / synthetic reporters). */
export const CspReportPayloadSchema = z.object({
  cspReport: z.object({
    documentUri: z.string().min(1),
    referrer: z.string().optional(),
    violatedDirective: z.string().min(1),
    effectiveDirective: z.string().min(1),
    originalPolicy: z.string().min(1),
    disposition: CspDispositionEnum,
    blockedUri: z.string().min(1),
    statusCode: z.number().int(),
    scriptSample: z.string().max(500).optional(),
  }),
});
export type CspReportPayload = z.infer<typeof CspReportPayloadSchema>;

/** Either envelope the report endpoint accepts (native first — browsers win). */
export const AnyCspReportEnvelopeSchema = z.union([NativeEnvelopeSchema, CspReportPayloadSchema]);
export type AnyCspReportEnvelope = z.infer<typeof AnyCspReportEnvelopeSchema>;

export const DomainWhitelistConfigSchema = z.object({
  tenantId: z.string().min(1),
  liffAppId: z.string().min(10),
  primaryDomain: z.string().url(),
  whitelistedDomains: z.array(z.string().url()).min(1),
  hlsCdnOrigin: z.string().url(),
  ebookCdnOrigin: z.string().url(),
  isActive: z.boolean().default(true),
});
export type DomainWhitelistConfig = z.infer<typeof DomainWhitelistConfigSchema>;

export const HlsStreamTokenPayloadSchema = z.object({
  videoId: z.string().min(1),
  playbackToken: z.string().min(1),
  expiresAt: z.number().int(),
  // https-only: zod .url() accepts custom schemes (line://, capacitor://)
  // which must never bind an HLS playback token (§8.2 token gate).
  allowedOrigin: z.string().url().startsWith('https://'),
  signature: z.string().min(1),
});
export type HlsStreamTokenPayload = z.infer<typeof HlsStreamTokenPayloadSchema>;

/** Normalized violation record (single shape for Redis + Prisma sinks). */
export const CspViolationRecordSchema = z.object({
  documentUri: z.string().min(1),
  violatedDirective: z.string().min(1),
  effectiveDirective: z.string().min(1),
  blockedUri: z.string().min(1),
  originalPolicy: z.string().min(1),
  statusCode: z.number().int().default(0),
  disposition: CspDispositionEnum.default('enforce'),
  scriptSample: z.string().max(500).optional(),
});
export type CspViolationRecord = z.infer<typeof CspViolationRecordSchema>;

export const SecuritySeverityEnum = z.enum(['INFO', 'WARNING', 'CRITICAL', 'BLOCKED_XSS']);
export type SecuritySeverity = z.infer<typeof SecuritySeverityEnum>;

/** Browser report endpoint (relative — served by the frontend proxy). */
export const CSP_REPORT_PATH = '/api/security/csp-report';
/** Redis pub/sub channel for violation analytics (§7.1). */
export const CSP_QUEUE = 'security:csp:logs';
/** Max report body the endpoint will read (64KB — Gate 5). */
export const CSP_MAX_BYTES = 64 * 1024;
/** R2 CORS preflight cache (seconds, §8.1). */
export const R2_CORS_MAX_AGE = 3600;

export const CDN_VIDEO = 'https://videocdn.omnichannel.com';
export const CDN_ASSET = 'https://cdn.omnichannel.com';
export const API_ORIGIN = 'https://api.omnichannel.com';
export const LIFF_ORIGIN = 'https://liff.line.me';

/** Normalize either envelope into the single sink record (null when unusable). */
export function normalizeCspReport(body: unknown): CspViolationRecord | null {
  const parsed = AnyCspReportEnvelopeSchema.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;
  if ('csp-report' in data) {
    const r = data['csp-report'];
    return {
      documentUri: r['document-uri'],
      violatedDirective: r['violated-directive'],
      effectiveDirective: r['effective-directive'] ?? r['violated-directive'],
      blockedUri: r['blocked-uri'],
      originalPolicy: r['original-policy'],
      statusCode: r['status-code'],
      disposition: r.disposition,
      ...(r['script-sample'] ? { scriptSample: r['script-sample'] } : {}),
    };
  }
  const r = data.cspReport;
  return {
    documentUri: r.documentUri,
    violatedDirective: r.violatedDirective,
    effectiveDirective: r.effectiveDirective,
    blockedUri: r.blockedUri,
    originalPolicy: r.originalPolicy,
    statusCode: r.statusCode,
    disposition: r.disposition,
    ...(r.scriptSample ? { scriptSample: r.scriptSample } : {}),
  };
}

/** Severity classifier (§7.2 rule + BLOCKED_XSS for inline/eval exfiltration). */
export function classifyCspSeverity(record: Pick<CspViolationRecord, 'violatedDirective' | 'blockedUri'> & { scriptSample?: string }): SecuritySeverity {
  const directive = record.violatedDirective.toLowerCase();
  const blocked = record.blockedUri.toLowerCase();
  const isScript = directive.includes('script-src');
  const isInlineExfil = blocked === 'inline' || blocked === 'eval' || typeof record.scriptSample === 'string';
  if (isScript && isInlineExfil) return 'BLOCKED_XSS';
  if (isScript) return 'CRITICAL';
  return 'WARNING';
}

export interface CspHeaderOptions {
  /** Per-request base64 nonce for script-src (empty string omits the nonce slot). */
  nonce?: string;
  /** Development adds 'unsafe-eval' (Next dev HMR); production never does. */
  isDev?: boolean;
}

/**
 * Single-source CSP directive builder (Nest middleware + parity-tested edge copy).
 * Keeps HLS blob streaming alive: media-src/worker-src allow blob: (§Gate 5).
 */
export function buildCspHeader(options: CspHeaderOptions = {}): string {
  const { nonce = '', isDev = false } = options;
  const scriptSrc = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`] : []),
    "'strict-dynamic'",
    'https://static.line-scdn.net',
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');
  return [
    "default-src 'self' https://api.omnichannel.com",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'img-src \'self\' data: blob: https://cdn.omnichannel.com https://profile.line-scdn.net https://*.line-scdn.net https://*.cloudflarestorage.com',
    'font-src \'self\' data: https://fonts.gstatic.com',
    'media-src \'self\' blob: https://videocdn.omnichannel.com https://*.cloudflarestorage.com',
    'connect-src \'self\' https://api.omnichannel.com https://videocdn.omnichannel.com https://cdn.omnichannel.com https://access.line.me https://api.line.me wss://api.omnichannel.com https://*.easyslip.com',
    'frame-src \'self\' https://access.line.me https://liff.line.me',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://liff.line.me https://*.line.me",
    'report-uri /api/security/csp-report',
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Origin allow-check supporting exact + `https://*.host` wildcard entries. */
export function isOriginWhitelisted(origin: string, whitelist: string[]): boolean {
  const o = origin.trim().toLowerCase();
  for (const entry of whitelist) {
    const e = entry.trim().toLowerCase();
    if (e === o) return true;
    if (e.startsWith('https://*.')) {
      const suffix = e.slice('https://*'.length);
      if (o.startsWith('https://') && o.endsWith(suffix) && o.length > 'https://'.length + suffix.length) return true;
    }
  }
  return false;
}
