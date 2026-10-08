// SSOT Phase 059 §3.1 — Reader Keyboard & Gesture Mapper contracts
// Canonical: packages/shared/src/schemas/navigation-event-contract.ts
// (legacy src/shared/schemas/navigation-event-contract.ts)
// - Verbatim shapes from §3.1: InputDeviceEnum, GestureTypeEnum,
//   NavigationActionEnum, NavigationEventPayload, UserReaderPreference.
// - Budgets: tap zones 25/50/25; swipe Δx≥50px, velocity>0.25px/ms,
//   vertical-lock <30°, window <400ms; tap <10px & <300ms; key throttle
//   200ms; accidental-tap window 1.5s; 60fps ⇒ 16ms frame budget.
// - Browser-safe: pure Zod + math helpers (no node:crypto) so LIFF hooks and
//   the gesture mapper can import directly. Zero new deps.
import { z } from 'zod';

export const InputDeviceEnum = z.enum(['TOUCH_SCREEN', 'KEYBOARD', 'MOUSE_CLICK', 'GAMEPAD_REMOTE']);
export type InputDevice = z.infer<typeof InputDeviceEnum>;

export const GestureTypeEnum = z.enum([
  'TAP_LEFT',
  'TAP_RIGHT',
  'TAP_CENTER',
  'SWIPE_LEFT',
  'SWIPE_RIGHT',
  'PINCH_ZOOM',
  'DOUBLE_TAP',
]);
export type GestureType = z.infer<typeof GestureTypeEnum>;

export const NavigationActionEnum = z.enum([
  'NEXT_PAGE',
  'PREV_PAGE',
  'GOTO_PAGE',
  'TOGGLE_HUD',
  'TOGGLE_FULLSCREEN',
  'ZOOM_IN',
  'ZOOM_OUT',
]);
export type NavigationAction = z.infer<typeof NavigationActionEnum>;

export const NavigationEventPayloadSchema = z.object({
  productId: z.string().uuid(),
  currentPage: z.number().int().positive(),
  action: NavigationActionEnum,
  deviceType: InputDeviceEnum,
  gestureDetails: z
    .object({
      gestureType: GestureTypeEnum.optional(),
      coordinateX: z.number().optional(),
      coordinateY: z.number().optional(),
      swipeVelocity: z.number().optional(),
      keyString: z.string().optional(),
    })
    .optional(),
  timestamp: z.string().datetime(),
});
export type NavigationEventPayload = z.infer<typeof NavigationEventPayloadSchema>;

export const UserReaderPreferenceSchema = z.object({
  userId: z.string().uuid(),
  invertTapZones: z.boolean().default(false),
  swipeSensitivity: z.number().min(0.1).max(2.0).default(1.0),
  enableKeyboardShortcuts: z.boolean().default(true),
  hapticFeedbackEnabled: z.boolean().default(true),
});
export type UserReaderPreference = z.infer<typeof UserReaderPreferenceSchema>;

// ---------- §2.1/§7.1 budgets + gesture/keyboard policy (single source) ----------
export const NAV_TAP_LEFT_EDGE = 0.25;
export const NAV_TAP_RIGHT_EDGE = 0.75;
export const NAV_SWIPE_MIN_DX_PX = 50;
export const NAV_SWIPE_MIN_VELOCITY_PX_MS = 0.25;
export const NAV_SWIPE_MAX_DURATION_MS = 400;
export const NAV_SWIPE_AXIS_RATIO = 1.5;
export const NAV_TAP_MAX_DELTA_PX = 10;
export const NAV_TAP_MAX_DURATION_MS = 300;
export const NAV_KEY_THROTTLE_MS = 200;
export const NAV_FRAME_BUDGET_MS = 16;
export const NAV_ACCIDENTAL_TAP_MS = 1500;
export const NAV_EVENT_STREAM_KEY = 'stream:reader:navigation-events';

export type TapZone = 'LEFT' | 'CENTER' | 'RIGHT';

/** Zone map for tap X (§2.1 25/50/25 split; inverted for left-handed mode). */
export function tapZoneFor(x: number, width: number, invertTapZones = false): TapZone {
  if (width <= 0) return 'CENTER';
  const ratio = x / width;
  const left: TapZone = invertTapZones ? 'RIGHT' : 'LEFT';
  const right: TapZone = invertTapZones ? 'LEFT' : 'RIGHT';
  if (ratio < NAV_TAP_LEFT_EDGE) return left;
  if (ratio > NAV_TAP_RIGHT_EDGE) return right;
  return 'CENTER';
}

export interface SwipeSample {
  deltaX: number;
  deltaY: number;
  deltaTimeMs: number;
  sensitivity?: number;
}

/** Swipe verdict (§1.3 BDD: velocity > 0.25px/ms, Δx ≥ 50px, vertical lock). */
export function swipeActionFor(sample: SwipeSample): 'NEXT_PAGE' | 'PREV_PAGE' | null {
  const sensitivity = sample.sensitivity && sample.sensitivity > 0 ? sample.sensitivity : 1;
  const minDx = NAV_SWIPE_MIN_DX_PX / sensitivity;
  if (sample.deltaTimeMs <= 0 || sample.deltaTimeMs >= NAV_SWIPE_MAX_DURATION_MS) return null;
  if (Math.abs(sample.deltaX) < minDx) return null;
  if (Math.abs(sample.deltaX) < Math.abs(sample.deltaY) * NAV_SWIPE_AXIS_RATIO) return null;
  const velocity = Math.abs(sample.deltaX) / sample.deltaTimeMs;
  if (velocity <= NAV_SWIPE_MIN_VELOCITY_PX_MS / sensitivity) return null;
  return sample.deltaX < 0 ? 'NEXT_PAGE' : 'PREV_PAGE';
}

export interface TapSample {
  deltaX: number;
  deltaY: number;
  deltaTimeMs: number;
}

/** True when the touch is a stationary tap (not a swipe/drag). */
export function isTap(sample: TapSample): boolean {
  return (
    Math.abs(sample.deltaX) < NAV_TAP_MAX_DELTA_PX &&
    Math.abs(sample.deltaY) < NAV_TAP_MAX_DELTA_PX &&
    sample.deltaTimeMs < NAV_TAP_MAX_DURATION_MS
  );
}

export type KeyNavIntent = 'NEXT_PAGE' | 'PREV_PAGE' | 'FIRST_PAGE' | 'LAST_PAGE' | 'TOGGLE_HUD' | 'TOGGLE_FULLSCREEN' | null;

/** Web keymap (§2.1 desktop shortcuts). Returns null for unmapped codes. */
export function keyIntentFor(code: string, shiftKey: boolean): KeyNavIntent {
  switch (code) {
    case 'Space':
      return shiftKey ? 'PREV_PAGE' : 'NEXT_PAGE';
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'NEXT_PAGE';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'PREV_PAGE';
    case 'Home':
      return 'FIRST_PAGE';
    case 'End':
      return 'LAST_PAGE';
    case 'KeyM':
      return 'TOGGLE_HUD';
    case 'KeyF':
      return 'TOGGLE_FULLSCREEN';
    default:
      return null;
  }
}

/** Focus guard (§2.1 accessibility): never steal keys while typing. */
export function isTypingTarget(el: { tagName?: string; getAttribute?: (name: string) => string | null } | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  try {
    return el.getAttribute?.('contenteditable') === 'true';
  } catch {
    return false;
  }
}

/** Clamp helper shared by the hook and the entity (sliding-window safe). */
export function clampPage(page: number, totalPages: number): number {
  const total = Number.isInteger(totalPages) && totalPages > 0 ? totalPages : 1;
  if (!Number.isInteger(page)) return 1;
  return Math.max(1, Math.min(total, page));
}

/** Accidental-tap detector (§7.1: flip-back within 1.5s ⇒ sensitivity tuning). */
export function isAccidentalFlip(flipAtMs: number, revertAtMs: number): boolean {
  return revertAtMs > flipAtMs && revertAtMs - flipAtMs < NAV_ACCIDENTAL_TAP_MS;
}
