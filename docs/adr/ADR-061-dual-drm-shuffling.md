# ADR-061: Dual DRM Canvas Shuffling (Ephemeral Keys + Trap Audit)

- Status: Accepted (Atomic Phase 061, PHASE-144-XZ-061)
- Date: 2026-10-08
- SSOT: `packages/shared/src/schemas/drm-shuffling.schema.ts`
  (`DrmShuffleAlgorithmEnum`, `ShufflingMatrixSeedSchema`,
  `EncryptedDrmChunkPayloadSchema` + `permutationFromSeed`/
  `invertPermutation`/`tileRects`/`isBijection` shared engine)
  + `packages/db/prisma/schema.prisma` (new `DrmSecurityKey`; `DrmViolationLog`
  additive: nullable `sessionId`/`userId`/`productId`/`pageNumber` +
  back-relations; Phase 049 rows stay valid, zero destructive changes)

## Context

Phase 049 shipped session tile-shuffle with LSB forensics. Phase 061 adds
the dual layer: storage-level scrambling (R2) + ephemeral per-page HMAC
keys, a WebGL deshuffle path, and active extraction traps — without
forking the Phase 049 engine (Zero Redundant Code: shared permutation
math, reused R2/Redis infra, read-only entitlement port).

## Decision

1. **Ephemeral keys, not stored pixels**: `DrmSecurityKey` (15min) holds
   the HMAC seed; 60s presigned scrambled blobs; pixels unscramble in
   RAM/canvas only, revoked per turn (<30MB).
2. **RISK_CALL deviations**: `violationType` stays an enum (stricter than
   the §4.1 String sketch); trap violations log with `sessionId=null`
   instead of fabricating a DrmSession.
3. **Scoped traps**: `installCanvasTheftTrap` patches prototypes but only
   intercepts the armed canvas (restorable); readers arm explicitly.
4. **Fallback-first rendering**: WebGL2 texture tiles → 2D tile copy →
   toast + retry (context-loss auto-recovery, §10).

## Consequences

- Breach events land in `DrmViolationLog` (≤500ms insert) + stream fan-out.
- Follow-up: AES-GCM envelope for the IDB scrambled-cell cache (§2.1).
