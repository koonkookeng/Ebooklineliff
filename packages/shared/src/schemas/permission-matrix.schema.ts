// SSOT Phase 106 §3.1 — Granular Bitwise Permission Matrix + JWT Scope Engine
// Canonical: packages/shared/src/schemas/permission-matrix.schema.ts
// (legacy src/shared/schemas/permission-matrix.schema.ts)
// - Spec-verbatim: BitwisePermissionFlags (64-bit BigInt) / JwtScopeSchema /
//   BitwiseMatrixPayloadSchema / EvaluatePermissionInputSchema /
//   TokenIntrospectionResponseSchema + GraphQL intent parity.
// - RISK_CALL deviations (additive-only, documented):
//   - tenantId/roleId/userId/jti accept min(1) strings (not strict uuid):
//     edge identity vocabulary (Phase 023-031 precedent); strict uuid 400s
//     valid LIFF sessions. Tests pin both uuid + short tenant slugs.
//   - JwtScopeSchema allows 2-4 colon segments (spec regex was markdown-escaped;
//     canonical: ^[a-z0-9_-]+(:[a-z0-9_*-]+){1,3}$) so tenant:COMP-1:ebook:read
//     and tenant:company-a:course:write both pass.
// - Zero new deps (zod only). BigInt <-> string at JSON boundary (Gate 2).
import { z } from 'zod';

// Bitwise Permission Flag Enum Mapping (64-bit range, §3.1 verbatim names).
export const BitwisePermissionFlags = {
  NONE: 0n,
  READ_CATALOG: 1n << 0n, // 1
  PURCHASE_PRODUCT: 1n << 1n, // 2
  READ_EBOOK_CHUNK: 1n << 2n, // 4
  STREAM_COURSE_HLS: 1n << 3n, // 8
  WRITE_REVIEW: 1n << 4n, // 16
  MANAGE_OWN_COURSE: 1n << 5n, // 32
  MANAGE_TENANT_STORE: 1n << 6n, // 64
  EXECUTE_PAYOUT: 1n << 7n, // 128
  MANAGE_PERMISSIONS: 1n << 8n, // 256
  SUPER_ADMIN_ALL: (1n << 62n) - 1n,
} as const;
export type BitwisePermissionFlagName = keyof typeof BitwisePermissionFlags;

export const BITMASK_MAX = BitwisePermissionFlags.SUPER_ADMIN_ALL;

/** Scope format: 'tenant:{tenantId}:{resource}:{action}' (2-4 segments, * wildcard). */
export const JwtScopeSchema = z
  .string()
  .regex(/^[a-z0-9_-]+:[a-z0-9_*-]+:[a-z0-9_*-]+(:[a-z0-9_*-]+)?$/, {
    message: "Scope must follow format: 'tenant:{tenantId}:{resource}:{action}'",
  });
export type JwtScope = z.infer<typeof JwtScopeSchema>;

export const BitwiseMatrixPayloadSchema = z.object({
  roleId: z.string().min(1),
  tenantId: z.string().min(1),
  permissionBitmask: z.string().regex(/^[0-9]+$/, 'Bitmask must be a BigInt string'),
  scopes: z.array(JwtScopeSchema),
});
export type BitwiseMatrixPayload = z.infer<typeof BitwiseMatrixPayloadSchema>;

export const EvaluatePermissionInputSchema = z.object({
  requiredBitmask: z.string().regex(/^[0-9]+$/, 'Bitmask must be a BigInt string'),
  requiredScope: JwtScopeSchema,
  tenantId: z.string().min(1),
});
export type EvaluatePermissionInput = z.infer<typeof EvaluatePermissionInputSchema>;

export const TokenIntrospectionResponseSchema = z.object({
  active: z.boolean(),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  bitmask: z.string().regex(/^[0-9]+$/),
  scopes: z.array(z.string()),
  jti: z.string().min(1),
  exp: z.number().int(),
});
export type TokenIntrospectionResponse = z.infer<typeof TokenIntrospectionResponseSchema>;

/** O(1) budgets (Gate 4/§10.1). */
export const BITWISE_EVAL_BUDGET_MS = 0.05;
export const BITWISE_EVAL_GUARD_MS = 0.1;
export const SCOPE_REVOKE_PROPAGATION_SEC = 1;
export const SCOPED_TOKEN_TTL_SEC = 900; // 15m short-lived (§8.1)
export const SECURITY_VIOLATION_STREAM = 'events:security:violations';
export const SECURITY_VIOLATION_THRESHOLD = 5;
export const SECURITY_VIOLATION_WINDOW_SEC = 60;

/** Redis key builders (single source — backend + tests). */
export function blacklistJtiKey(jti: string): string {
  return `blacklist:jti:${jti}`;
}
export function roleMatrixKey(tenantId: string, roleId: string): string {
  return `security:matrix:{${tenantId}}:${roleId}`;
}
export function scopeRateKey(userId: string): string {
  return `security:violations:${userId}`;
}

/** O(1) BigInt check: (userMask & required) === required. Throws on bad input. */
export function hasBit(userBitmask: string, requiredBitmask: string): boolean {
  const user = BigInt(userBitmask);
  const required = BigInt(requiredBitmask);
  if (required < 0n || user < 0n) throw new Error('Bitmask must be unsigned');
  if (required > BITMASK_MAX || user > BITMASK_MAX) throw new Error('Bitmask exceeds 62-bit range');
  return (user & required) === required;
}

/** Bits in required that user lacks (decimal string, "0" when allowed). */
export function missingBits(userBitmask: string, requiredBitmask: string): string {
  const user = BigInt(userBitmask);
  const required = BigInt(requiredBitmask);
  return (required & ~user).toString();
}

export function grantBit(current: string, flag: bigint): string {
  return (BigInt(current) | flag).toString();
}

export function revokeBit(current: string, flag: bigint): string {
  return (BigInt(current) & ~flag).toString();
}

/** Wildcard scope matcher: user '*' or embedded '*' globs the required scope. */
export function matchScopePattern(required: string, userScopes: string[]): boolean {
  return userScopes.some((userScope) => {
    if (userScope === '*' || userScope === required) return true;
    const regexPattern = '^' + userScope.replace(/\*/g, '.*') + '$';
    return new RegExp(regexPattern).test(required);
  });
}

/** Strict tenant boundary: scope must start with `tenant:<tenantId>:` or `tenant:*:`. */
export function isTenantScopeAllowed(scope: string, tenantId: string): boolean {
  if (scope === '*') return true;
  if (!scope.startsWith('tenant:')) return false;
  const parts = scope.split(':');
  if (parts.length < 3) return false;
  const scopeTenant = parts[1];
  return scopeTenant === tenantId || scopeTenant === '*';
}

/** Extract tenant segment from a well-formed scope (null when malformed). */
export function tenantOfScope(scope: string): string | null {
  const parts = scope.split(':');
  if (parts.length < 2 || parts[0] !== 'tenant') return null;
  return parts[1] ?? null;
}
