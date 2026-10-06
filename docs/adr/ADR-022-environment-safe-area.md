# ADR-022: Mini App Environment Detection & Safe-Area Handling

- Status: Accepted (Atomic Phase 022, PHASE-144-XZ-022)
- Date: 2026-10-07
- SSOT: `packages/db/prisma/schema.prisma` (`EnvironmentType`, `UserDeviceMetric`) + `packages/shared/src/schemas/environment-contract.ts`

## Context

LINE LIFF in-app browsers, standalone PWAs, and mobile webviews overlay native chrome
(Dynamic Island, notch, home indicator, LINE bottom dock) on web UI. Checkout CTAs and
reader controls were at risk of being obscured, hurting conversion. Detection must cost
<0.5MB RAM and never block rendering or the <1s payment SLA.

## Decision

1. **UA + `display-mode` detection, 7 environments** (`useEnvironmentDetection`): LINE UA
   token × iOS/Android split first, then standalone, Safari/Chrome, known in-app UAs, and a
   `<1024px` width fallback. SSR-safe defaults; single probe element per update; rAF-throttled
   resize/orientation listeners.
2. **CSS vars as the layout contract** (`--sat/--sab/--sal/--sar`, `--real-vh`): hook writes
   to `:root`; components consume via `safe-area.css` tokens (`pt-safe`, `pb-safe`,
   `h-dvh-custom`, `.safe-bottom-bar` with `var(--sab) + 12px`). `--real-vh` covers legacy
   Android webviews where `env()` returns 0px.
3. **5-state provider** (`SafeAreaProvider`): `ENV_DETECTING` skeleton with 44px spacers
   prevents layout shift; then `LIFF_NATIVE_VIEW` / `STANDALONE_PWA` / `MOBILE_WEBVIEW` /
   `DESKTOP_BROWSER` (desktop resets insets via media query). Ships §10.5 self-healing
   (`verifyAndSelfHealLayout`) for clipped CTAs.
4. **Fire-and-forget analytics** (`EnvironmentAnalyticsService`): Zod-gated, async Prisma
   write that never blocks the response (Gate 7); layout-mode mapping
   (`LIFF_EMBEDDED_COMPACT` / `WEBVIEW_FULLSCREEN_SAFE` / `STANDARD_WEB`); obscurity signal
   log when touch + narrow + zero bottom inset. No PII in logs.
5. **Prisma expand-contract**: `UserDeviceMetric` + `EnvironmentType` appended; `User`
   back-relation added; `userId` nullable so anonymous metrics persist. No migration
   hand-SQL (Prisma-owned).
6. **No router/native-bridge changes** (out of scope): reader integration is a pure wrapper
   (`CanvasReaderSafeAreaWrapper`) with injectable chrome slots.

## Consequences

- Bottom bars and reader controls clear native chrome on all 7 environments; desktop
  unaffected (insets reset).
- Device metrics accumulate per tenant for AI layout tuning, at zero UI cost.
- Follow-up (out of scope): wire service into a REST/GQL mutation resolver when the
  analytics API surface (Phase 052 owner) is ready; client sync call site.
