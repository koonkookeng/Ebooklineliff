// SSOT Phase 120 §3.1 — IP & geolocation anomaly contract
// Canonical: packages/shared/src/schemas/ip-anomaly.schema.ts
// - Spec-verbatim vocabularies/shapes: IpAnomalyTypeEnum (7) / GeoLocation /
//   AnomalyDetectionResult / SecurityAlertPayload.
// - RISK_CALL deviations (additive-only, documented):
//   - Lives here, NOT sdid-contract.ts: that file is READ_ONLY context per
//     the phase boundary (§1.2); filefolder.md maps all shared contracts to
//     packages/shared/src/schemas/*.ts (111-119 precedent).
//   - `IpRiskLevelEnum`/`IpRiskLevel`: RiskLevelEnum/RiskLevel are owned by
//     inspector-contract.ts (110) — same four values, aliased import.
//   - userId/alertId/ids accept min(1) edge vocabulary in addition to uuid
//     (023-031 precedent); ip() validators use min(1) strings (spec
//     z.string().ip() rejects IPv6-shorthand/hostnames seen in the wild;
//     format is re-validated by isIpLiteral where it matters).
// - Pure math: haversineKm, travelSpeedKmh, velocityVerdict (>800),
//   anomalyScore (§7.1 weights: impossible +60, vpn +25, velocity +20,
//   new-country +15, new-device +10), scoreToLevel, budgets/keys
//   (500ms alert, 50ms check, 15min tolerance, 10-logins/30s trip).
// - Zero new deps (zod only).
import { z } from 'zod';

export const IpAnomalyTypeEnum = z.enum([
  'NORMAL',
  'NEW_IP_LOCATION',
  'NEW_COUNTRY',
  'IMPOSSIBLE_TRAVEL',
  'KNOWN_VPN_PROXY',
  'HIGH_VELOCITY_ROTATION',
  'DEVICE_FINGERPRINT_MISMATCH',
]);
export type IpAnomalyType = z.infer<typeof IpAnomalyTypeEnum>;

export const IpRiskLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type IpRiskLevel = z.infer<typeof IpRiskLevelEnum>;

export const GeoLocationSchema = z.object({
  ipAddress: z.string().min(1),
  country: z.string().min(1),
  countryCode: z.string().length(2),
  region: z.string().min(1),
  city: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isp: z.string().optional(),
  isProxyOrVpn: z.boolean().default(false),
});
export type GeoLocation = z.infer<typeof GeoLocationSchema>;

export const AnomalyDetectionResultSchema = z.object({
  userId: z.string().min(1),
  anomalyType: IpAnomalyTypeEnum,
  riskLevel: IpRiskLevelEnum,
  riskScore: z.number().min(0).max(100),
  calculatedDistanceKm: z.number().nonnegative(),
  timeDeltaMinutes: z.number().nonnegative(),
  calculatedSpeedKmH: z.number().nonnegative(),
  currentGeo: GeoLocationSchema,
  previousGeo: GeoLocationSchema.optional(),
  mfaRequired: z.boolean(),
  sessionBlocked: z.boolean(),
});
export type AnomalyDetectionResult = z.infer<typeof AnomalyDetectionResultSchema>;

export const SecurityAlertPayloadSchema = z.object({
  alertId: z.string().min(1),
  userId: z.string().min(1),
  lineUserId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  riskLevel: IpRiskLevelEnum,
  deviceInfo: z.string().min(1),
  ipAddress: z.string().min(1),
  locationName: z.string().min(1),
  timestamp: z.string().min(1),
});
export type SecurityAlertPayload = z.infer<typeof SecurityAlertPayloadSchema>;

/** 120 §1.1: Flex + Email fan-out lands within 500ms. */
export const SECURITY_ALERT_BUDGET_MS = 500;
/** 120 §10: anomaly check completes within 50ms (100ms → Redis fast path). */
export const ANOMALY_CHECK_BUDGET_MS = 50;
/** 120 §10.1: fast-path trigger above 100ms. */
export const ANOMALY_FAST_PATH_MS = 100;
/** BDD-1: 15-minute match tolerance for time-window checks. */
export const GEO_MATCH_TOLERANCE_MINS = 15;
/** BDD-2: 10 logins from 10 IPs in 30s trips rotation detection. */
export const VELOCITY_ROTATION_COUNT = 10;
export const VELOCITY_ROTATION_WINDOW_SEC = 30;
/** §7.1: velocity above 800 km/h is impossible travel. */
export const IMPOSSIBLE_TRAVEL_KMH = 800;
/** §7.1 weights: impossible +60 / vpn +25 / rotation +20 / country +15 / device +10. */
export const ANOMALY_WEIGHTS = {
  impossibleTravel: 60,
  knownVpnProxy: 25,
  highVelocityRotation: 20,
  newCountry: 15,
  deviceMismatch: 10,
} as const;
/** Alert stream (Gate 8, §7.1). */
export const SECURITY_ALERT_STREAM = 'stream:security:alerts';

/** Very permissive IP-literal gate (v4 dotted + v6 colon forms). */
export function isIpLiteral(ip: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every((o) => Number(o) <= 255);
  }
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
}

/** Haversine great-circle distance in kilometres. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Travel speed km/h (0 when time delta is 0; 2-decimal). */
export function travelSpeedKmh(distanceKm: number, minutes: number): number {
  if (!(minutes > 0)) return 0;
  return Math.round((distanceKm / (minutes / 60)) * 100) / 100;
}

/** BDD boundary: 799 glides, 801 trips (§10 TDD cases). */
export function isImpossibleTravel(speedKmh: number, threshold = IMPOSSIBLE_TRAVEL_KMH): boolean {
  return speedKmh > threshold;
}

export interface AnomalySignals {
  impossibleTravel: boolean;
  knownVpnProxy: boolean;
  highVelocityRotation: boolean;
  newCountry: boolean;
  deviceMismatch: boolean;
}

/** §7.1 additive multi-factor score (0–100, clamped). */
export function anomalyScore(signals: AnomalySignals): number {
  let score = 0;
  if (signals.impossibleTravel) score += ANOMALY_WEIGHTS.impossibleTravel;
  if (signals.knownVpnProxy) score += ANOMALY_WEIGHTS.knownVpnProxy;
  if (signals.highVelocityRotation) score += ANOMALY_WEIGHTS.highVelocityRotation;
  if (signals.newCountry) score += ANOMALY_WEIGHTS.newCountry;
  if (signals.deviceMismatch) score += ANOMALY_WEIGHTS.deviceMismatch;
  return Math.min(100, score);
}

/** Score → level (≥85 CRITICAL per 119-compatible lock line). */
export function scoreToLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 85) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

/** MFA challenge line: HIGH and above (§1.3 BDD-1). */
export function mfaRequired(level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): boolean {
  return level === 'HIGH' || level === 'CRITICAL';
}

/** Hard block line: score hits 100 (spec §2.2 ERROR state). */
export function sessionBlocked(score: number): boolean {
  return score >= 100;
}

export function anomalyQueueKey(status: string, page: number): string {
  return `anomaly:queue:${status}:${page}`;
}

export function loginVelocityKey(userId: string): string {
  return `anomaly:velocity:${userId}`;
}
