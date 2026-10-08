// SSOT Phase 056 §3.1 — Universal Player & Reader Viewport Router contracts
// Canonical: packages/shared/src/schemas/viewport-contract.ts
// (legacy src/shared/schemas/viewport-contract.ts)
// - Verbatim shapes from §3.1: RuntimeEnvironmentEnum, ViewportCapabilities,
//   ViewportStateSync (+ code-first input alias for the GQL mutation).
// - Budgets: LIFF RAM <30MB (strict), Web 512MB; desktop breakpoint 1024px;
//   watermark refresh 15s; Redis viewport-session TTL 3600s; LIFF→Web
//   fallback self-heal 500ms (§10).
// - Browser-safe: string-only helpers (no node:crypto) so LIFF hooks can import.
import { z } from 'zod';

export const RuntimeEnvironmentEnum = z.enum([
  'LINE_LIFF_MOBILE',
  'LINE_LIFF_DESKTOP',
  'WEB_MOBILE_PWA',
  'WEB_DESKTOP_WORKSPACE',
]);
export type RuntimeEnvironment = z.infer<typeof RuntimeEnvironmentEnum>;

export const ViewportCapabilitiesSchema = z.object({
  environment: RuntimeEnvironmentEnum,
  isLiff: z.boolean(),
  screenWidth: z.number().int().positive(),
  screenHeight: z.number().int().positive(),
  devicePixelRatio: z.number().positive(),
  maxRamBudgetMB: z.number().int().default(30),
  supportsTouch: z.boolean(),
});
export type ViewportCapabilities = z.infer<typeof ViewportCapabilitiesSchema>;

export const ViewportStateSyncSchema = z.object({
  productId: z.string().uuid(),
  contentType: z.enum(['EBOOK', 'COURSE_VIDEO']),
  lastPageNumber: z.number().int().positive().optional(),
  lastWatchedSec: z.number().int().nonnegative().optional(),
  viewportMode: RuntimeEnvironmentEnum,
  timestamp: z.string().datetime(),
});
export type ViewportStateSync = z.infer<typeof ViewportStateSyncSchema>;

// GraphQL input surface (§3.2 ViewportStateSyncInput): productId + contentType
// + progress cursors + mode. Timestamp is server-stamped, so it stays optional.
export const ViewportStateSyncInputSchema = z.object({
  productId: z.string().uuid(),
  contentType: z.enum(['EBOOK', 'COURSE_VIDEO']),
  lastPageNumber: z.number().int().positive().optional(),
  lastWatchedSec: z.number().int().nonnegative().optional(),
  viewportMode: RuntimeEnvironmentEnum,
});
export type ViewportStateSyncInput = z.infer<typeof ViewportStateSyncInputSchema>;

export const WatermarkConfigSchema = z.object({
  watermarkText: z.string().min(1),
  hashSignature: z.string().min(1),
  refreshIntervalSec: z.number().int().positive(),
});
export type WatermarkConfig = z.infer<typeof WatermarkConfigSchema>;

export const ViewportConfigPayloadSchema = z.object({
  productId: z.string().uuid(),
  recommendedMode: RuntimeEnvironmentEnum,
  maxMemoryLimitMB: z.number().int().positive(),
  hlsStreamUrl: z.string().nullable().optional(),
  ebookChunkBaseUrl: z.string().nullable().optional(),
  watermarkConfig: WatermarkConfigSchema,
});
export type ViewportConfigPayload = z.infer<typeof ViewportConfigPayloadSchema>;

// ---------- §1.3/§2.1 budgets + routing policy (single source) ----------
export const VIEWPORT_LIFF_RAM_MB = 30;
export const VIEWPORT_WEB_RAM_MB = 512;
export const VIEWPORT_DESKTOP_BREAKPOINT_PX = 1024;
export const VIEWPORT_WATERMARK_REFRESH_SEC = 15;
export const VIEWPORT_SESSION_TTL_SEC = 3600;
export const VIEWPORT_LIFF_FALLBACK_MS = 500;
export const VIEWPORT_PROGRESS_SYNC_BUDGET_MS = 200;

/** Classify the runtime from LIFF presence + CSS viewport width (§1.3 BDD). */
export function detectRuntimeEnvironment(isLiff: boolean, width: number): RuntimeEnvironment {
  if (isLiff) return width < VIEWPORT_DESKTOP_BREAKPOINT_PX ? 'LINE_LIFF_MOBILE' : 'LINE_LIFF_DESKTOP';
  return width < VIEWPORT_DESKTOP_BREAKPOINT_PX ? 'WEB_MOBILE_PWA' : 'WEB_DESKTOP_WORKSPACE';
}

/** Strict 30MB on LIFF, high-performance budget on Web (§5.1). */
export function ramBudgetFor(isLiff: boolean): number {
  return isLiff ? VIEWPORT_LIFF_RAM_MB : VIEWPORT_WEB_RAM_MB;
}

/** Sliding prefetch window: N-1..N+1 on LIFF, N-2..N+2 on Web (§6.3). */
export function viewportSlidingWindowPages(page: number, isLiff: boolean): number[] {
  const radius = isLiff ? 1 : 2;
  const out: number[] = [];
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 1) out.push(p);
  }
  return out;
}

/** Redis edge key for the per-user viewport session (§5.1 step 4). */
export function viewportSessionKey(userId: string, productId: string): string {
  return `viewport:session:${userId}:${productId}`;
}

/** Forensic watermark line (§5.1 step 3): display name + short id + day. */
export function watermarkTextFor(displayName: string, userId: string, at: Date = new Date()): string {
  const day = at.toISOString().split('T')[0];
  return `${displayName || 'User'} | ID: ${userId.slice(0, 8)} | ${day}`;
}

/** True for either LIFF runtime (mobile-first touch + bottom-sheet shell). */
export function isLiffEnvironment(env: RuntimeEnvironment): boolean {
  return env === 'LINE_LIFF_MOBILE' || env === 'LINE_LIFF_DESKTOP';
}
