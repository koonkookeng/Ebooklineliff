// SSOT Phase 033 §3.1 — Auto-update version Zod SSOT contract
// Canonical: packages/shared/src/schemas/version-contract.ts
// (legacy src/shared/schemas/version-contract.ts)
// - Spec-verbatim: UpdatePolicyEnum / AppVersionSchema / VersionCheckRequestSchema
//   / VersionCheckResponseSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - tenantId is z.string().min(1), not uuid: runtime tenant key is the slug
//     hint (Phase 006/021/023–032 precedent).
//   - Adds ClientDeviceLogSchema (spec §4.1 ClientDeviceLog row) + pure
//     compareSemver()/evaluateUpdate() shared by the Nest service and tests
//     (single decision source, Gate 1).
// - Zero new deps (zod only).
import { z } from 'zod';

export const UpdatePolicyEnum = z.enum(['OPTIONAL', 'RECOMMENDED', 'FORCE_IMMEDIATE']);
export type UpdatePolicy = z.infer<typeof UpdatePolicyEnum>;

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'Invalid semantic version');

export const AppVersionSchema = z.object({
  tenantId: z.string().min(1),
  version: semver,
  buildHash: z.string().min(8),
  minSupportedVersion: semver,
  updatePolicy: UpdatePolicyEnum,
  releaseNotes: z.string().max(2000).optional(),
  assetsManifestUrl: z.string().url().optional(),
  releasedAt: z.string().datetime(),
});
export type AppVersion = z.infer<typeof AppVersionSchema>;

export const VersionPlatformEnum = z.enum(['LINE_LIFF', 'WEB_DESKTOP', 'MOBILE_PWA']);
export type VersionPlatform = z.infer<typeof VersionPlatformEnum>;

export const VersionCheckRequestSchema = z.object({
  tenantId: z.string().min(1),
  clientVersion: z.string().min(1),
  clientBuildHash: z.string().min(1),
  platform: VersionPlatformEnum,
});
export type VersionCheckRequest = z.infer<typeof VersionCheckRequestSchema>;

export const VersionCheckResponseSchema = z.object({
  isLatest: z.boolean(),
  needsForceUpdate: z.boolean(),
  latestVersion: z.string().min(1),
  latestBuildHash: z.string().min(1),
  updatePolicy: UpdatePolicyEnum,
  downloadUrl: z.string().url().optional(),
  releaseNotes: z.string().max(2000).optional(),
});
export type VersionCheckResponse = z.infer<typeof VersionCheckResponseSchema>;

export const ClientDeviceLogSchema = z.object({
  tenantId: z.string().min(1),
  lineUserId: z.string().min(1).optional(),
  clientVersion: z.string().min(1),
  clientBuildHash: z.string().min(1),
  platform: VersionPlatformEnum,
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().max(500).optional(),
});
export type ClientDeviceLog = z.infer<typeof ClientDeviceLogSchema>;

/** Edge cache TTL for the latest release pointer (5 min, §5.2). */
export const VERSION_CACHE_TTL_SEC = 300;
export const VERSION_CACHE_PREFIX = 'version:latest';
/** Infinite-loop guard: max consecutive auto-reloads (sessionStorage, §10). */
export const UPDATE_LOOP_MAX = 2;
export const UPDATE_LOOP_KEY = 'app-update-count';

export function versionCacheKey(tenantId: string): string {
  return `${VERSION_CACHE_PREFIX}:${tenantId}`;
}

/** Numeric semver compare (-1 | 0 | 1); non-numeric segments compare as 0. */
export function compareSemver(v1: string, v2: string): -1 | 0 | 1 {
  const parts = (v: string) => v.split('.').map((p) => {
    const n = Number(p);
    return Number.isFinite(n) ? n : 0;
  });
  const a = parts(v1);
  const b = parts(v2);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return 1;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return -1;
  }
  return 0;
}

export interface LatestRelease {
  version: string;
  buildHash: string;
  minSupportedVersion: string;
  updatePolicy: UpdatePolicy;
  releaseNotes?: string;
}

/** Edge-cached release pointer shape (Gate 4: rejects poisoned cache rows). */
export const LatestReleaseSchema = z.object({
  version: semver,
  buildHash: z.string().min(8),
  minSupportedVersion: semver,
  updatePolicy: UpdatePolicyEnum,
  releaseNotes: z.string().max(2000).optional(),
});

/**
 * Single update-decision source (§5.2 rule): hash mismatch = stale; force when
 * the release demands it OR the client fell below min-supported.
 */
export function evaluateUpdate(
  clientVersion: string,
  clientBuildHash: string,
  latest: LatestRelease,
): Pick<VersionCheckResponse, 'isLatest' | 'needsForceUpdate' | 'updatePolicy'> {
  const isLatest = latest.buildHash === clientBuildHash;
  const belowMin = compareSemver(clientVersion, latest.minSupportedVersion) < 0;
  const needsForceUpdate = !isLatest && (latest.updatePolicy === 'FORCE_IMMEDIATE' || belowMin);
  return { isLatest, needsForceUpdate, updatePolicy: latest.updatePolicy };
}
