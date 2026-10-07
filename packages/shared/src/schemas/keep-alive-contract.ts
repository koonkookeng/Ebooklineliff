// SSOT Phase 031 §3.1 — Keep-alive viewport state Zod SSOT contract
// Canonical: packages/shared/src/schemas/keep-alive-contract.ts
// (legacy src/shared/schemas/keep-alive-contract.ts)
// - Spec-verbatim: ViewportTypeEnum / Ebook+Video+Checkout state schemas /
//   KeepAliveSyncPayloadSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - productId/lessonId/orderId/userId/tenantId are z.string().min(1), not uuid:
//     ids flow as opaque strings at the edge (Phase 023–030 precedent); uuid
//     strictness 400s valid LIFF sessions and seed flows.
//   - draftSlipBase64 capped at 700KB (sessionStorage vault budget ~5MB shared
//     with reader offline chunks; oversized drafts are rejected, not truncated).
//   - Adds KeepAliveStatusEnum (5-state machine §2.2) + key/TTL/budget constants
//     + pickViewportState() discriminator shared by client and server.
// - Zero new deps (zod only).
import { z } from 'zod';

export const ViewportTypeEnum = z.enum(['EBOOK_READER', 'VIDEO_PLAYER', 'CHECKOUT_FORM', 'CATALOG_DISCOVERY']);
export type ViewportType = z.infer<typeof ViewportTypeEnum>;

export const EbookKeepAliveStateSchema = z.object({
  productId: z.string().min(1),
  currentPage: z.number().int().positive(),
  scrollOffsetTop: z.number().nonnegative().default(0),
  zoomScale: z.number().positive().default(1.0),
  activeChapterId: z.string().min(1).optional(),
});
export type EbookKeepAliveState = z.infer<typeof EbookKeepAliveStateSchema>;

export const VideoKeepAliveStateSchema = z.object({
  lessonId: z.string().min(1),
  playedSeconds: z.number().nonnegative().default(0),
  playbackRate: z.number().positive().default(1.0),
  volume: z.number().min(0).max(1).default(1.0),
});
export type VideoKeepAliveState = z.infer<typeof VideoKeepAliveStateSchema>;

export const CheckoutKeepAliveStateSchema = z.object({
  orderId: z.string().min(1),
  step: z.enum(['ADDRESS', 'PROMPTPAY_QR', 'SLIP_UPLOAD']),
  draftSlipBase64: z.string().max(700000).nullable().optional(),
  expiresAt: z.string().datetime(),
});
export type CheckoutKeepAliveState = z.infer<typeof CheckoutKeepAliveStateSchema>;

export const KeepAliveSyncPayloadSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  viewportType: ViewportTypeEnum,
  timestamp: z.number().int().nonnegative(),
  ebookState: EbookKeepAliveStateSchema.optional(),
  videoState: VideoKeepAliveStateSchema.optional(),
  checkoutState: CheckoutKeepAliveStateSchema.optional(),
});
export type KeepAliveSyncPayload = z.infer<typeof KeepAliveSyncPayloadSchema>;

/** 5-state viewport machine (§2.2). */
export const KeepAliveStatusEnum = z.enum([
  'LIFF_INIT',
  'ACTIVE',
  'BACKGROUND_PRESERVED',
  'HYDRATING',
  'ERROR_FALLBACK',
]);
export type KeepAliveStatus = z.infer<typeof KeepAliveStatusEnum>;

/** Server sync TTL: 15 min checkout-restore window (BDD Scenario 3). */
export const KEEPALIVE_TTL_SEC = 900;
/** Foreground snapshot cadence while ACTIVE (§2.2: offsets every 2s). */
export const KEEPALIVE_SAVE_INTERVAL_MS = 2000;
/** Rehydration budget: viewport restored within 150ms (BDD Scenarios 1-3). */
export const REHYDRATE_BUDGET_MS = 150;
/** IndexedDB vault (heavy assets) + sessionStorage mirror (drafts). */
export const KEEPALIVE_DB = 'zene-keepalive';
export const KEEPALIVE_STORE = 'viewport_states';
/** Redis key + analytics channel (Gate 7/8). */
export const KEEPALIVE_CHANNEL = 'liff.app_switch';
export function keepAliveKey(viewportType: string, resourceId: string): string {
  return `viewport:${viewportType}:${resourceId}`;
}
export function keepAliveRedisKey(userId: string, tenantId: string, viewportType: string): string {
  return `keepalive:${userId}:${tenantId}:${viewportType}`;
}

/** Extract the matching state branch for a viewport type (null when absent). */
export function pickViewportState(payload: KeepAliveSyncPayload): unknown {
  switch (payload.viewportType) {
    case 'EBOOK_READER':
      return payload.ebookState ?? null;
    case 'VIDEO_PLAYER':
      return payload.videoState ?? null;
    case 'CHECKOUT_FORM':
      return payload.checkoutState ?? null;
    default:
      return null;
  }
}
