# ADR-083: Gamification Engine (Streak, Badges, Reward Redemption)

## Status
Accepted — Phase 083 DONE (verified 100/100 x3).

## Context
Phase 083 spec requires Duolingo-style check-in streaks with freeze
protection, milestone badges with viral Flex sharing, and an atomic
points-catalog redemption path — without touching reader/HLS memory paths,
without hand-written migrations, and without colliding with the 096 squad
gamification scope that shares the module folder.

## Decision
- **Streak:** server-UTC day keys (client time never trusted), Redis mutex
  fail-closed, `@@unique(userId, checkinDate)` as the second idempotency
  line, multiplier 7d→1.5x/30d→2x, freeze auto-consume inline + nightly
  sweep endpoint (cron-ready, no scheduler dep).
- **Badges:** seed catalog (Master Reader / Week Warrior / Month Master),
  stat-threshold evaluator, P2002-safe unlock replays, unlock stream for
  the Flex share card (R2 icons, zero-egress).
- **Redemption:** Zod gate → velocity tripwire (>5/min freeze signal) →
  one transaction (cover, points, stock, redemption, entitlement) <500ms.
  Entitlement writes ride the redeem txn (shared-module reuse).
- **Clients:** inline-SVG flame + CSS celebration (no lucide/framer —
  Gate 5), IndexedDB catalog/badge snapshots offline, SSE-free polling
  hub (no socket.io).
- **Boundaries:** 096 subscriber/listener/point-engine/anti-cheat files
  stay scaffolds (test-asserted); `modules/reward/*` not created — the
  catalog lives in the gamification module to avoid split-brain ledgers.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state hub,
  UTC + Redlock + velocity guards, lean client, R2 badge assets, atomic
  redeem txn, gamification stream, this ADR.
- Regression: 083 x3 + 082/081 green; backend/frontend typecheck clean;
  bundle guard PASS.
