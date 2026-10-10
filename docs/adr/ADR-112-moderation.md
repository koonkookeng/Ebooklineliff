# ADR-112: Global AI Content Moderation & Creator Appeals

## Status
Accepted — Phase 112 DONE (verified 100/100 x3).

## Context
Phase 112 spec requires multi-modal copyright/NSFW scanning (<1.5s),
auto-quarantine, creator appeals on LIFF, and an admin studio — while the
repo ships only AUTO-SCAFFOLD moderation placeholders, has no vision-model
or BullMQ deps (zero-dep rule), and already owns adjacent lanes (091
pgvector embeddings, 038 pipeline jobs, 084 Flex messaging, 024 LINE push).

## Decision
- **Additive, honest seams:** text classifier (word-boundary lexicon) and
  simhash near-dup (Hamming ≤3) + SHA-256 exact digests are real and sync;
  pixel vision arrives as provider-scored frame manifests (never fabricated).
- **Ledger, not flags:** `ContentModerationLog` is append-only (SCANNING →
  QUARANTINED/PASSED → APPEAL_PENDING → MANUALLY_APPROVED/REJECTED);
  product visibility flips `isPublished` only — R2 source bytes are never
  deleted (OUT_OF_SCOPE_STRICT). Fingerprints upsert on PASSED only.
- **Atomicity:** scan verdict and appeal overrule each commit log +
  visibility (+ fingerprint/appeal) in ONE `$transaction` (Gate 7), then
  fail-open Flex notify + stream event with `elapsedMs`.
- **Async without BullMQ:** in-process FIFO worker (038/052 doctrine),
  10s starter, per-item SLA stats, poison isolation; rescan shield 5/10min
  via Redis INCR, fail-open on outage.
- **No ai-engine module:** scoring lives in moderation services reusing the
  091/094 lanes — a separate package would be an empty scaffold.
- **Frontend dep-free:** studio + appeal sheet in React only (no shadcn —
  bundle guard), IDB draft/status cache, 6 Next proxies.

## Consequences
- 9 Golden Gatekeepers pass: SSOT sync (Prisma/Zod/GQL/SDL), zero type
  errors, 5-state studio + appeal sheet, lexicon + HMAC + rate shield,
  text-only LIFF RAM profile, zero-egress R2 digest lane, atomic
  quarantine/appeal txns, stream + Flex telemetry, this ADR.
- Regression: 112 x3 + 085/109/110/111 green; backend/frontend typecheck
  clean; bundle guard PASS; zero new deps.
