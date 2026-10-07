# ADR-049: DRM Canvas Tile Shuffling (QR-style Sessions + LSB Forensics)

- Status: Accepted (Atomic Phase 049, PHASE-049-DRM-SHUFFLE)
- Date: 2026-10-07
- SSOT: `packages/shared/src/schemas/drm-contract.ts`
  (`DrmSecurityLevelEnum`, `DrmViolationTypeEnum`, `PixelTileMatrixSchema`,
  `DrmSessionHandshakeSchema`, `ForensicPayloadSchema`,
  `DecryptChunkPayloadSchema` + `isValidPermutation`/`invertPermutation`/
  `tileGrid`/`embedLsb`/`extractLsb` shared engine)
  + `packages/db/prisma/schema.prisma` (`DrmViolationType`,
  `DrmSession` with persisted grid dims + `DrmViolationLog`,
  `User.drmSessions`/`Product.drmSessions` back-relations; client
  regenerated, zero destructive changes)

## Context

E-book pages must survive screenshot/recording theft on LINE LIFF while
staying under 30MB RAM and 60 FPS, with no new dependencies and R2
zero-egress delivery.

## Decision

1. **Shuffle server-side, descramble in a worker**: `DrmShufflingService`
   builds a seeded Fisher-Yates permutation (`SHA256(seed:userId:i)`,
   64px tiles) persisted per 15-min session; the `pixel-unshuffle.worker`
   is the single descramble engine (transferable buffers, immediate blob
   revoke), sharing `embedLsb`/`extractLsb` with the backend forensic
   extractor from one SSOT implementation.
2. **Entitlement-gated ephemeral grants**: chunk serving requires a live,
   unrevoked, owner-matched session; >5 pixel pulls/sec revokes the session
   immediately (§7.1), hijack reports revoke + persist an audit row, and
   violation telemetry fans out to Redis (fail-open, <500ms budget).
3. **Tamper fallback on the client**: context-menu/PrintScreen traps post
   to `/api/drm/violation` and repaint deterministic noise; the reader
   implements the 5-state machine with inline-SVG glyphs (no lucide-react
   dep, per zero-new-deps precedent).
4. **Transport parity**: code-first GQL (`initDrmSession`,
   `getEbookPageDrmChunk`, `reportPiracyViolation`) + SDL supplement +
   `/api/v1/drm/*` REST + 3 Next proxies, wired via useFactory `DrmModule`.

## Consequences

- Stolen R2 bytes render as scrambled tiles without the session matrix.
- Leaked photos carry an extractable LSB identity payload for legal action.
- 7 contract checks x3 loops + 048/047/046 regressions green; backend
  typecheck keeps only the 1 pre-existing reader legacy-alias error.
