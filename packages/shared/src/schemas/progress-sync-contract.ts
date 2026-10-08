// SSOT Phase 057 §3.1 — Real-time cross-device progress sync contracts
// Canonical: packages/shared/src/schemas/progress-sync-contract.ts
// (legacy src/shared/schemas/progress-sync-contract.ts)
// - Verbatim shapes: SyncContentTypeEnum, EbookProgressSync,
//   VideoProgressSync, SyncBroadcastPayload (+ GQL ForceSync input schema).
// - Budgets: room fan-out <100ms, client throttle 3s, DB write-back 30s,
//   wire payload <200 bytes, WS ticket TTL 30s (§2.1/§8.1/§10).
// - Browser-safe: string-only helpers (no node:crypto).
// - TRANSPORT NOTE (§5.2 deviation, ADR-057): socket.io is NOT a dependency
//   (heavy LIFF bundle, Fastify friction, zero-new-dep policy). Realtime runs
//   SSE server→client + REST/beacon POST client→server; these contracts are
//   transport-agnostic and bind to either.
import { z } from 'zod';

export const SyncContentTypeEnum = z.enum(['EBOOK', 'COURSE_LESSON']);
export type SyncContentType = z.infer<typeof SyncContentTypeEnum>;

export const EbookProgressSyncSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  ebookId: z.string().uuid(),
  lastPage: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  deviceId: z.string().min(1),
  clientTimestamp: z.number().int(),
});

export const VideoProgressSyncSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  lessonId: z.string().uuid(),
  watchedSec: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  isCompleted: z.boolean(),
  deviceId: z.string().min(1),
  clientTimestamp: z.number().int(),
});

export const SyncBroadcastPayloadSchema = z.object({
  contentType: SyncContentTypeEnum,
  ebookData: EbookProgressSyncSchema.optional(),
  videoData: VideoProgressSyncSchema.optional(),
  serverTimestamp: z.number().int(),
});

export type EbookProgressSync = z.infer<typeof EbookProgressSyncSchema>;
export type VideoProgressSync = z.infer<typeof VideoProgressSyncSchema>;
export type SyncBroadcastPayload = z.infer<typeof SyncBroadcastPayloadSchema>;

// §3.2 forceSyncProgress fallback (REST + GQL share this gate).
export const ForceSyncInputSchema = z.object({
  productId: z.string().uuid(),
  contentType: SyncContentTypeEnum,
  lastPage: z.number().int().positive().optional(),
  watchedSec: z.number().int().nonnegative().optional(),
});
export type ForceSyncInput = z.infer<typeof ForceSyncInputSchema>;

export const SyncProgressPayloadGqlSchema = z.object({
  contentType: z.string(),
  lastPage: z.number().int().nullable().optional(),
  watchedSec: z.number().int().nullable().optional(),
  isCompleted: z.boolean().nullable().optional(),
  updatedAt: z.string(),
  deviceId: z.string(),
});
export type SyncProgressPayloadGql = z.infer<typeof SyncProgressPayloadGqlSchema>;

// ---------- §2.1/§8.1/§10 budgets + routing policy (single source) ----------
export const SYNC_NAMESPACE = '/ws/progress-sync';
export const SYNC_FANOUT_BUDGET_MS = 100;
export const SYNC_CLIENT_THROTTLE_MS = 3000;
export const SYNC_WRITEBACK_SEC = 30;
export const SYNC_WIRE_MAX_BYTES = 200;
export const SYNC_TICKET_TTL_SEC = 30;
export const SYNC_CHANNEL_PREFIX = 'sync:room:';

/** Tenant-isolated room key (§2.1): tenant:{t}:user:{u}. */
export function syncRoomKey(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

/** Redis pub/sub channel for a user room. */
export function syncRoomChannel(tenantId: string, userId: string): string {
  return `${SYNC_CHANNEL_PREFIX}${syncRoomKey(tenantId, userId)}`;
}

/** §5.2 BDD: fast edge-cache keys for ebook page + video timestamp. */
export function ebookProgressCacheKey(userId: string, ebookId: string): string {
  return `progress:ebook:${userId}:${ebookId}`;
}

export function videoProgressCacheKey(userId: string, lessonId: string): string {
  return `progress:video:${userId}:${lessonId}`;
}

/** Write-back queue names (BullMQ-compatible; drained every 30s). */
export function syncQueueName(contentType: SyncContentType): string {
  return contentType === 'EBOOK' ? 'ebook_progress' : 'video_progress';
}

/** Zero-egress guard (§8.1): sync wire payloads stay under 200 bytes. */
export function isSyncPayloadWithinBudget(payload: unknown): boolean {
  try {
    return JSON.stringify(payload).length < SYNC_WIRE_MAX_BYTES;
  } catch {
    return false;
  }
}

/** Last-Write-Wins (§2.2 SYNC_CONFLICT): newer clientTimestamp prevails. */
export function lastWriteWins(aClientTs: number, bClientTs: number): 'a' | 'b' {
  return bClientTs > aClientTs ? 'b' : 'a';
}
