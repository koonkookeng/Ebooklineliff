# ADR-118: Immutable Audit Logs & Hash-Chain Vault

## Status
Accepted — Phase 118 DONE (verified 100/100 x3).

## Context
Phase 118 spec requires hash-chained, WORM-backed, append-only admin
auditing — while 109 already writes a simpler AuditLog shape (executor/
target columns, live writers), 115 chains override hashes in Redis, and
R2/line/stream lanes exist. Replacing the AuditLog model would break 109;
duplicating crypto would fork the chain math.

## Decision
- **Union, not replace:** 109 columns stay; 118 adds sequence/hash/
  signature/status columns + 3 enums + sync-state table. New rows mirror
  both lanes. Canonical seq-0 link form keeps append and verify exact
  (sequence is DB-assigned; order rides previousHash).
- **Single formula:** chain/signer engines delegate to contract
  primitives (one implementation, asserted by parity tests).
- **Append-only twice:** create-only repository (structural) + advisory
  trigger SQL for DBA review (never auto-applied — OUT_OF_SCOPE).
  Tamper response never updates rows: streams + Flex + 109-lock handoff.
- **Defense in depth:** finance-role GQL/REST, auditor-only hash reads
  (server-masked + client mirror), HMAC webhook-grade guards on intake,
  fail-open audit that can never break business mutations (in-txn
  appends documented for financial paths).
- **Frontend dep-free:** no shadcn/lucide/tanstack (text glyphs + CSS),
  5-state console, 3 proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync, zero type errors, 5-state UI,
  HMAC + trigger + dual control, <2ms/block, zero-egress WORM, atomic
  appends, stream + Flex telemetry, this ADR.
- Regression: 118 x3 + 085/109/110/111/112/113/114/115/116/117 green;
  backend/frontend clean; bundle guard PASS; zero new deps.
