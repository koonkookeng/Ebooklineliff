// SSOT Phase 027 §3.1 — Mini App Navigation Control Router Zod SSOT Contract
// Canonical: packages/shared/src/schemas/navigation.schema.ts
// (spec §3.1 lives under src/shared/schemas/sdid-contract.ts; canonical maps to
// packages/shared/src per filefolder.md; dedicated file per zero-redundant policy)
// - Spec-verbatim: NavigationStackItem / NavigationState / NavigationSyncPayload.
// - RISK_CALL deviations (documented, additive-only):
//   - userId/lineUserId/tenantId are z.string().min(1), not uuid: ids flow as opaque
//     strings at the edge (Phase 023/024/025/026 precedent); uuid strictness 400s
//     valid LIFF sessions (e.g. tenant slug 'default').
//   - pathname/lastPathname/currentRoute must start with '/' + no '..' (traversal
//     guard, Phase 025 precedent); stateSnapshotJson capped at 32KB (RAM/edge guard).
// - Zero new deps (zod only). Edge-safe pure helpers (no node:crypto here).
import { z } from 'zod';

/** Max internal route stack depth before GC flush (RAM guard Gate 5). */
export const NAV_STACK_MAX_DEPTH = 50;
/** Max persisted snapshot payload (bytes) — keeps Redis row + R2-free path lean. */
export const NAV_SNAPSHOT_MAX_BYTES = 32 * 1024;
/** Navigation session edge-cache TTL (30 days, study/quiz progress window). */
export const NAV_SESSION_TTL_SEC = 30 * 24 * 3600;
/** Redis pub/sub channel for drop-off analytics (§7.1). */
export const NAV_DROP_OFF_CHANNEL = 'navigation.drop_off_detected';
/** Router stack RAM budget in MB (§2.1: <1.5MB of the 30MB LIFF total). */
export const NAV_STACK_BUDGET_MB = 1.5;

export const NavigationStackItemSchema = z.object({
  id: z.string().uuid(),
  pathname: z
    .string()
    .startsWith('/')
    .refine((p) => !p.includes('..'), { message: 'Path traversal blocked' }),
  searchParams: z.record(z.string(), z.string()).default({}),
  timestamp: z.number().int(),
  isDirty: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type NavigationStackItem = z.infer<typeof NavigationStackItemSchema>;

export const NavigationStateSchema = z.object({
  tenantId: z.string().min(1),
  currentRoute: z
    .string()
    .startsWith('/')
    .refine((p) => !p.includes('..'), { message: 'Path traversal blocked' }),
  canGoBack: z.boolean(),
  stackDepth: z.number().int().nonnegative(),
  isModalOpen: z.boolean().default(false),
  activeModalId: z.string().nullable().default(null),
  isDirtyState: z.boolean().default(false),
  historyStack: z.array(NavigationStackItemSchema).default([]),
});
export type NavigationState = z.infer<typeof NavigationStateSchema>;

export const NavigationSyncPayloadSchema = z.object({
  userId: z.string().min(1),
  lineUserId: z.string().min(1),
  lastPathname: z
    .string()
    .startsWith('/')
    .refine((p) => !p.includes('..'), { message: 'Path traversal blocked' }),
  stateSnapshotJson: z.string().min(2).max(NAV_SNAPSHOT_MAX_BYTES),
});
export type NavigationSyncPayload = z.infer<typeof NavigationSyncPayloadSchema>;

// ---------- UI state machine (§2.2 — 5 mandatory states) ----------
export const NavUiStateEnum = z.enum([
  'LIFF_SHELL_INIT',
  'ROOT_STACK',
  'SUB_STACK',
  'MODAL_DRAWER_ACTIVE',
  'DIRTY_STATE_GUARD',
]);
export type NavUiState = z.infer<typeof NavUiStateEnum>;

export const NavDropOffEventSchema = z.object({
  event: z.literal('nav.drop_off_detected'),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  pathname: z.string().startsWith('/'),
  reason: z.enum(['ROOT_CLOSE', 'DIRTY_CONFIRMED_EXIT', 'DIRTY_ABANDONED']),
  at: z.number().int(),
});
export type NavDropOffEvent = z.infer<typeof NavDropOffEventSchema>;

/** Redis edge key for a user's navigation session snapshot. */
export function navSessionKey(userId: string): string {
  return `navigation:session:${userId}`;
}

/** Derive the 5-state UI machine from store flags (priority: modal > dirty > depth). */
export function deriveNavUiState(input: {
  shellReady: boolean;
  isModalOpen: boolean;
  isDirtyState: boolean;
  stackDepth: number;
}): NavUiState {
  if (!input.shellReady) return 'LIFF_SHELL_INIT';
  if (input.isModalOpen) return 'MODAL_DRAWER_ACTIVE';
  if (input.isDirtyState) return 'DIRTY_STATE_GUARD';
  if (input.stackDepth > 1) return 'SUB_STACK';
  return 'ROOT_STACK';
}
