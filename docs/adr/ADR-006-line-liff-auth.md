# ADR-006: LINE LIFF Seamless Authentication Architecture

- Status: Accepted (Atomic Phase 006, PHASE-144-XZ-006)
- Date: 2026-10-06
- SSOT: `packages/db/prisma/schema.prisma` + `packages/shared/src/schemas/auth-contract.ts`

## Context

Phase 005 shipped unified SSO (dual-token, guards, edge middleware). Phase 006 narrows to the
LINE Mini App / LIFF zero-friction handshake: `liff.getIDToken()` -> verify -> auto-provision,
budget <300ms and <15MB RAM, multi-tenant aware.

## Decision

1. **Verify-endpoint primary, JWKS kid-check cached 24h** (`LineVerifierService`).
   Local RS256 crypto would need `jsonwebtoken`/`jwks-rsa`; zero-dep `fetch` + base64url decode
   plus the LINE verify engine gives the same guarantee with no new dependencies.
   Definitive kid mismatch rejects; fetch/cache failures fail open to the verify endpoint.
2. **Replay guard**: `exp` enforced + `iat` freshness 5min (§8.1), fail-fast `INVALID_LINE_TOKEN`.
3. **Tenant-gated provisioning** (`Tenant` registry + `User.tenantId?` optional). `tenantId`
   stays optional until the backfill migration (expand-contract); auth binds it at provision time.
4. **No duplicate session table**: canonical runtime `Session` (Phase 005 superset) is reused;
   Phase 006's `AuthSession` shape is not created (zero-redundant policy). New state lives in
   `LineAuthProfile` (1:1, `lastLoginAt`) only.
5. **Single auth checkpoint**: `JwtAuthGuard` (Phase 005) unchanged; `LineLiffGuard` added only
   for pre-session token verification. `JwtTokenService` is a naming facade over `TokenService`.
6. **Memory-only frontend tokens**: provider keeps the user object in React memory; session rides
   HTTP-Only `__Host-` cookies. The spec's `localStorage` token snippet was deliberately not
   followed (XSS §8.1).
7. **Analytics**: `user.registered` / `user.logged_in` published best-effort to Redis
   channel `auth-events` (in addition to `AuthAuditLog` rows).

## Consequences

- New users: atomic `User + LineAuthProfile` create; returning users: profile sync +
  `lastLoginAt` + referral bind when unset; entitlements untouched (same UUID).
- `me`/`logout` GraphQL aliases and `LiffAuthInput` object form added additively; Phase 005
  flat-args clients unaffected.
- Follow-ups: `User.tenantId` required + backfill (Phase 07x multi-tenant), RS256 local verify
  if LINE verify latency ever breaches the 300ms budget.
