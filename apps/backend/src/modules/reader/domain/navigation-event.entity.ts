// SSOT Phase 059 §5.1 — NavigationEvent entity (intent → clamped page)
// Canonical: apps/backend/src/modules/reader/domain/navigation-event.entity.ts
// (legacy src/backend/modules/reader/domain/navigation-event.entity.ts)
// - Pure, tsx-safe. resolveTargetPage maps a NavigationAction to the next
//   page under the sliding-window clamp; buildEvent stamps a valid payload
//   (server timestamp) for the Redis stream (§7.1/§11 Gate 8).
// - Watermark layer is untouched by construction (page intents carry no
//   canvas bytes — Gate 4). Zero new deps.
import {
  clampPage,
  type NavigationAction,
  type NavigationEventPayload,
} from '@repo/shared';

export interface NavigationIntent {
  productId: string;
  currentPage: number;
  totalPages: number;
  action: NavigationAction;
  targetPage?: number;
}

/** Resolve the destination page for an intent (GOTO clamps, FIRST/LAST pin). */
export function resolveTargetPage(intent: NavigationIntent): number {
  switch (intent.action) {
    case 'NEXT_PAGE':
      return clampPage(intent.currentPage + 1, intent.totalPages);
    case 'PREV_PAGE':
      return clampPage(intent.currentPage - 1, intent.totalPages);
    case 'GOTO_PAGE':
      return clampPage(intent.targetPage ?? intent.currentPage, intent.totalPages);
    case 'TOGGLE_HUD':
    case 'TOGGLE_FULLSCREEN':
    case 'ZOOM_IN':
    case 'ZOOM_OUT':
      return clampPage(intent.currentPage, intent.totalPages);
    default:
      return clampPage(intent.currentPage, intent.totalPages);
  }
}

/** Build a stream-ready event (validated shape, server timestamp). */
export function buildNavigationEvent(
  intent: NavigationIntent,
  deviceType: NavigationEventPayload['deviceType'],
  gestureDetails?: NavigationEventPayload['gestureDetails'],
  at: Date = new Date(),
): NavigationEventPayload {
  return {
    productId: intent.productId,
    currentPage: clampPage(intent.currentPage, intent.totalPages),
    action: intent.action,
    deviceType,
    gestureDetails,
    timestamp: at.toISOString(),
  };
}
