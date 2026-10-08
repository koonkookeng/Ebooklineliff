# ADR-059: Reader Keyboard & Gesture Mapper (Store-as-Bus Navigation)

- Status: Accepted (Atomic Phase 059, PHASE-059-KEYBOARD-GESTURE)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/navigation-event-contract.ts`
  (`InputDeviceEnum`, `GestureTypeEnum`, `NavigationActionEnum`,
  `NavigationEventPayloadSchema`, `UserReaderPreferenceSchema` +
  `tapZoneFor`/`swipeActionFor`/`isTap`/`keyIntentFor`/`isTypingTarget`/
  `clampPage`/`isAccidentalFlip` + 25/50/25, 50px/0.25px-ms/400ms,
  200ms-throttle, 16ms-frame, 1.5s-accidental budgets)
  + `packages/db/prisma/schema.prisma` (`UserReaderPreference` additive:
  `invertTapZones`/`swipeSensitivity`/`enableKeyboardShortcuts`/
  `hapticFeedbackEnabled`/`customKeybindingsJson`; client regenerated,
  zero destructive changes)

## Context

E-book paging lived in three places: local canvas state (LIFF + Web),
the `useReaderStore` (slider/bookmarks), and a primitive Web keydown
(no focus guard, no throttle). Touch zones and full keyboard maps had no
SSOT, and catalogue totals arrive as a 1-page placeholder.

## Decision

1. **Store-as-bus**: `useReaderNavigation` is the single paging engine
   (clamped intents + 200ms key throttle + typing focus guard);
   `CanvasReader`/`AdaptiveCanvasReader` adopt store turns one-way and
   write back local turns via `setCurrentPageExact`.
2. **Unknown totals stay optimistic**: single-step forward allowed past
   the placeholder; the canvas 404 → ERROR retry path guards the true
   end (Gate 5 RAM discipline untouched).
3. **No double-bind**: the legacy Web inline keydown moved into the hook
   (LIFF keeps touch only); prefs/analytics are fail-open, JWT-gated,
   zero new deps (R2 egress unaffected — interaction-only).

## Consequences

- Gesture/keyboard prefs persist atomically (`ReaderPreferenceService`
  upsert + sanitized keymap VO); navigation beacons ride sendBeacon →
  202 proxies for device-ratio/accidental-tap heatmaps.
- Follow-up: backfill real `totalPages` from `EbookDetail` to retire the
  optimistic clamp and the 10000-free upper bound.
