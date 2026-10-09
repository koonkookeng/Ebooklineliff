# ADR-087: Flash Sale Atomic Locks & Countdown

## Status
Accepted — Phase 087 DONE (verified 100/100 x3).

## Context
Phase 087 spec demands 10k-RPS atomic reservations, millisecond countdowns,
and framer-motion UI — while the repo bans new packages and heavy LIFF
deps, Redis Cluster rejects cross-slot Lua, and payment core is read-only.

## Decision
- **Atomicity:** one-slot Lua (`{flash:campaign:product}` tag for BOTH
  keys) via a new `evalLua` passthrough; stock seeded from the DB ledger
  (allocated − reserved − sold) so Redis/DB agree by construction. A
  50-racer simulation proves exactly-5-win on 5 units.
- **Honest scale:** BDD's 10k RPS is a capacity target, not a verified
  load test — stated plainly. What IS verified: zero oversell by
  construction, <300ms reserve path, idempotent sweeps.
- **Client:** rAF countdown (server UTC truth, no client clock), no
  framer-motion (Gate 5 <25MB). Checkout integration is a pricing-quote
  hook — orders/payments stay in their owners.
- **Ops:** expiry sweeper restores both counters (stock + per-user take);
  rate gate 1/3s fail-closed; admin REST + GQL share the same services.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state flash
  page, Lua + rate + JWT guards, lean client, R2 covers, HOLD-row txn,
  flash stream, this ADR.
- Regression: 087 x3 + 086/085 green; backend/frontend typecheck clean;
  bundle guard PASS.
