// SSOT Phase 127 §3.1 — security & DR contract
// Canonical: packages/shared/src/schemas/security-dr.schema.ts
// (legacy src/shared/schemas/sdid-security-dr-contract.ts)
// - Spec-verbatim: ThreatSeverityEnum / DisasterTypeEnum /
//   SecurityIncidentLogSchema (payload cap 1000) /
//   DisasterRecoveryStatusSchema / SecurityRateLimitRuleSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - incidentId/userIdHash accept min(1) (spec uuid is the narrow case;
//     hashes are hex, 023-031 precedent).
//   - activeRegionEndpoint accepts min(1) (internal endpoints fail url()).
// - Pure helpers: severity ranking, DR budgets, rate-limit keys, SQLi/XSS
//   signal matchers (single implementation shared by WAF lanes).
//   Zero new deps (zod only).
import { z } from 'zod';

export const ThreatSeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type ThreatSeverity = z.infer<typeof ThreatSeverityEnum>;

export const DisasterTypeEnum = z.enum([
  'DATABASE_OUTAGE',
  'REDIS_CACHE_FAILURE',
  'R2_STORAGE_UNREACHABLE',
  'NETWORK_DDOS',
]);
export type DisasterType = z.infer<typeof DisasterTypeEnum>;

export const SecurityIncidentLogSchema = z.object({
  incidentId: z.string().min(1),
  userIdHash: z.string().min(1).nullable(),
  ipAddress: z.string().ip(),
  userAgent: z.string().min(1),
  threatType: z.string().min(1),
  severity: ThreatSeverityEnum,
  payloadSnippet: z.string().max(1000),
  timestamp: z.string().datetime(),
});
export type SecurityIncidentLog = z.infer<typeof SecurityIncidentLogSchema>;

export const DisasterRecoveryStatusSchema = z.object({
  primaryRegionStatus: z.enum(['HEALTHY', 'DEGRADED', 'DOWN']),
  secondaryRegionStatus: z.enum(['HEALTHY', 'STANDBY', 'PROMOTED']),
  lastDatabaseBackupTimestamp: z.string().datetime(),
  currentRPOInSeconds: z.number().nonnegative(),
  isFailoverActive: z.boolean(),
  activeRegionEndpoint: z.string().min(1),
});
export type DisasterRecoveryStatus = z.infer<typeof DisasterRecoveryStatusSchema>;

export const SecurityRateLimitRuleSchema = z.object({
  endpointPattern: z.string().min(1),
  maxRequestsPerMinute: z.number().int().positive(),
  blockDurationSeconds: z.number().int().positive(),
});
export type SecurityRateLimitRule = z.infer<typeof SecurityRateLimitRuleSchema>;

/** BDD-2: RTO ceiling (5 min) + RPO ceiling (60s). */
export const DR_RTO_BUDGET_MS = 5 * 60 * 1000;
export const DR_RPO_BUDGET_SEC = 60;
/** BDD-2: 3 missed heartbeats (30s) trip failover. */
export const DR_HEARTBEAT_MISSES = 3;
export const DR_HEARTBEAT_INTERVAL_MS = 10000;
/** BDD-1: attacker IP throttle window (24h). */
export const ATTACKER_BLOCK_TTL_SEC = 86400;
/** GraphQL DoS guard (depth 6, §6.1). */
export const GQL_MAX_DEPTH = 6;
/** Audit payload cap (1000 chars, §3.1). */
export const AUDIT_SNIPPET_MAX = 1000;
/** WAL archive cadence (60s, §8.2 PITR). */
export const WAL_ARCHIVE_SEC = 60;
/** Security event stream (Gate 8 SIEM lane). */
export const SECURITY_EVENT_STREAM = 'stream:security-incidents';

/** Severity rank (CRITICAL highest; for escalation math). */
export function severityRank(severity: ThreatSeverity): number {
  return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[severity];
}

/** True when RPO/RTO posture meets the BDD-2 budgets. */
export function drPostureOk(rpoSeconds: number, rtoMs: number): boolean {
  return rpoSeconds < DR_RPO_BUDGET_SEC && rtoMs < DR_RTO_BUDGET_MS;
}

/** Rate-limit counter key (endpoint-scoped, IP-scoped). */
export function securityRateLimitKey(endpointPattern: string, ip: string): string {
  return `ratelimit:${endpointPattern}:${ip}`;
}

/** Attacker block key (24h throttle lane). */
export function attackerBlockKey(ip: string): string {
  return `security:block:${ip}`;
}

/** SQLi signal patterns (WAF pre-filter; Prisma prepared statements are the real guard). */
const SQLI_SIGNALS = [
  /(\bUNION\b\s+\bSELECT\b)/i,
  /(\bOR\b\s+1\s*=\s*1)/i,
  /(--\s*$)/,
  /(\bDROP\b\s+\bTABLE\b)/i,
  /(\bINSERT\b\s+\bINTO\b)/i,
  /';/,
];

/** XSS signal patterns (WAF pre-filter; output-encoding is the real guard). */
const XSS_SIGNALS = [
  /<\s*script/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /<\s*iframe/i,
  /<\s*img[^>]*onerror/i,
];

/** True when input trips a SQLi pre-filter signal. */
export function looksLikeSqlInjection(input: string): boolean {
  return SQLI_SIGNALS.some((re) => re.test(input));
}

/** True when input trips an XSS pre-filter signal. */
export function looksLikeXss(input: string): boolean {
  return XSS_SIGNALS.some((re) => re.test(input));
}

/** Truncate audit snippets to the 1000-char cap. */
export function capSnippet(snippet: string): string {
  return snippet.length > AUDIT_SNIPPET_MAX ? snippet.slice(0, AUDIT_SNIPPET_MAX) : snippet;
}
