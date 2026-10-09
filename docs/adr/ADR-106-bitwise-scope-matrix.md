# ADR-106: Bitwise Permission Matrix + JWT Scope Engine

## Status
Accepted — Phase 106 DONE (verified 100/100 x3).

## Context
Phase 106 spec wants O(1) authorization (<0.05ms, no DB hit), strict
multi-tenant JWT scope boundaries, and <1s JTI revocation fan-out —
while keeping LIFF memory <0.5MB, zero new deps, and Phase 032
device-permission contracts untouched.

## Decision
- **Bitwise SSOT:** `BitwisePermissionFlags` (62-bit BigInt) + `hasBit` /
  `missingBits` / `grantBit` / `revokeBit` in `@repo/shared`; domain
  `PermissionBitmask` VO owns unsigned/range guards; `BitwiseEvaluatorService`
  measures `evaluatedInMs` with `hrtime.bigint` (DB-free).
- **Scopes:** `JwtScopePattern` VO owns wildcard + tenant-boundary logic;
  `ScopeMatcherService` delegates (single logic point); `JwtScopeGuard`
  rejects cross-tenant use before pattern match (BDD-2 403).
- **Tokens:** `TokenScopeService` issues HS256 short-lived (15m, 1-tenant)
  scoped JWTs with Node crypto only (RS256 documented target, kid rotation
  via `JWT_SECRET_PREV`); `hydrate()` serves LIFF_INIT; revocation rides
  `RedisTokenBlacklistAdapter` SET-NX (`blacklist:jti:{jti}`) for <1s edge
  fan-out (BDD-3).
- **Persistence:** `SecurityRole` / `RoleScopeRegistry` / `UserTenantRole`
  / `RevocationBlacklist` / `SecurityAuditLog` are additive expand-contract
  rows; `PrismaSecurityRoleRepository.updateMatrix` runs upsert + scope
  replace + audit in ONE `$transaction` (Gate 7). No `prisma format`
  rewrites (exact-spacing regression guard for Phase 104/105 tests).
- **Guards:** single logic in `presentation/guards` (`BitwisePermissionGuard`
  + `JwtScopeGuard`); `modules/auth/guards` are re-export aliases;
  `@RequireBitwise` / `@RequireScopes` use inherited decorator pattern
  (§9.1, no per-controller duplication).
- **Frontend:** `PermissionMatrixBuilder` (in-memory BigInt, decimal readout,
  scope editor, zero-dep) + `usePermission` 5-state hook + `permission-matrix-client`
  (shared toggle helpers) + 2 Next proxies; matrix persist seam echoes
  offline-first SUCCESS.

## Consequences
- Authorization is O(1) microsecond-regime with audit on every deny
  (`SecurityAuditLog` append-only; violation stream `events:security:violations`).
- Blast radius is one tenant per token; stolen JTIs die edge-wide in <1s.
- Tradeoff: HS256 ships as zero-dep default (no RS256/JWKS libs per
  RISK_CALL); rotation path is preserved for the asymmetric upgrade.
