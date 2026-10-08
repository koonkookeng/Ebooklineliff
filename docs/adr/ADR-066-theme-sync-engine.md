# ADR-066: Cross-Platform Theme Sync (Reading Preference Engine)

- Status: Accepted (Atomic Phase 066, PHASE-066-THEME-SYNC)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/theme-preference.schema.ts`
  (`ThemeModeEnum` 5-value, `ReadingFontFamilyEnum`,
  `UserReadingPreferenceSchema`, `UpdatePreferenceInputSchema` +
  `THEME_TOKENS`/`preferenceCacheKey`/`preferenceChannel`/
  `resolveThemeMode`/`canvasFilterFor` + budgets)
  + Prisma `ThemeMode` / `ReadingFontFamily` / `UserReadingPreference`
  (+ `User.notes`-style back-relation `User.readingPreference`)
- Barrel note: `ThemeModeEnum`/`ThemeMode` alias to
  `ReadingThemeModeEnum`/`ReadingThemeMode` — the 4-value names are owned
  by Phase 041 `reader-control-contract` (local reader prefs); 066 is the
  synced cross-platform profile.

## Context

Phase 041 stores local reader-control prefs (string theme, no sync).
Phase 066 adds the synced profile: 5 theme modes + typography +
brightness, persisted to PostgreSQL, cached 24h on the edge, fanned out
cross-device <100ms, offline-capable on LIFF, canvas-safe <30MB RAM.

## Decision

1. **RISK_CALL deviations (zero-new-dep LIFF policy):**
   - No `zustand` — dep-free `useSyncExternalStore` (Phase 011/065
     precedent, same getState/selector API).
   - No WebSocket/`socket.io` — SSE (`@Sse` + rxjs, existing deps) over
     the generic `RedisPubSubAdapter` room channel (ADR-057 precedent);
     the GQL `Subscription` stays a contract declaration, transport is SSE.
   - No IndexedDB migration for prefs — localStorage instant load (FOUT
     prevention) + single-row LWW flush on `online` (no queue needed for
     a scalar profile); cross-tab via `BroadcastChannel`.
   - No canvas fork — `CanvasReader` consumes the provider-owned
     `--canvas-filter` CSS var (GPU-composited, zero re-render, RAM-neutral).
     The spec's `reader-canvas.tsx` path maps to this integration.
2. **Zero-trust + ownership:** JWT identity only (body `userId` never
   trusted); Zod gates at service boundary; rollback to last-acked
   snapshot on ERROR (§2.2).
3. **Cache + analytics:** read-through 24h + write-through invalidate;
   `preference_updated` room event + `events:preference-changed` stream
   for the circadian eye-strain engine (§7.1).
4. **UI:** `ThemeProvider` (tokens + SYSTEM tracking + tab/device sync),
   `ThemeToggle` (5 modes + A± stepper, 44px targets), mounted inside
   `TenantThemeProvider` (tenant vars compose underneath).

## Consequences

- Theme changes propagate cross-device within the fan-out budget.
- Follow-ups: semantic circadian prompting (§7.1), STUDY_GROUP-style
  shared reading profiles.
