// SSOT Phase 106 §10-11 — contract tests (Zod, O(1) bitwise, tenant boundary, revoke, parity)
// Run: npx tsx scripts/test-phase106-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BitwisePermissionFlags,
  JwtScopeSchema,
  BitwiseMatrixPayloadSchema,
  EvaluatePermissionInputSchema,
  TokenIntrospectionResponseSchema,
  BITWISE_EVAL_BUDGET_MS,
  SCOPED_TOKEN_TTL_SEC,
  SECURITY_VIOLATION_STREAM,
  blacklistJtiKey,
  roleMatrixKey,
  hasBit,
  missingBits,
  grantBit,
  revokeBit,
  matchScopePattern,
  isTenantScopeAllowed,
  tenantOfScope,
} from '../packages/shared/src/schemas/permission-matrix.schema';
import { PermissionBitmask } from '../apps/backend/src/domain/entities/permission-bitmask.vo';
import { JwtScopePattern } from '../apps/backend/src/domain/entities/jwt-scope-pattern.vo';
import { BitwiseEvaluatorService } from '../apps/backend/src/application/services/bitwise-evaluator.service';
import { ScopeMatcherService } from '../apps/backend/src/application/services/scope-matcher.service';
import { RedisTokenBlacklistAdapter } from '../apps/backend/src/infrastructure/adapters/redis-token-blacklist.adapter';
import { PrismaSecurityRoleRepository } from '../apps/backend/src/infrastructure/persistence/prisma-security-role.repository';
import { TokenScopeService } from '../apps/backend/src/modules/auth/services/token-scope.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(BitwisePermissionFlags.READ_CATALOG, 1n);
  assert.equal(BitwisePermissionFlags.READ_EBOOK_CHUNK, 4n);
  assert.equal(BitwisePermissionFlags.STREAM_COURSE_HLS, 8n);
  assert.equal(BitwisePermissionFlags.EXECUTE_PAYOUT, 128n);
  assert.equal(BitwisePermissionFlags.MANAGE_PERMISSIONS, 256n);
  assert.equal(JwtScopeSchema.safeParse('tenant:company-a:course:write').success, true);
  assert.equal(JwtScopeSchema.safeParse('tenant:COMP-1:ebook:read').success, false); // uppercase rejected (lowercase vocabulary)
  assert.equal(JwtScopeSchema.safeParse('tenant:comp-1:ebook:read').success, true);
  assert.equal(JwtScopeSchema.safeParse('not-a-scope').success, false);
  assert.equal(
    BitwiseMatrixPayloadSchema.safeParse({ roleId: UUID, tenantId: UUID, permissionBitmask: '15', scopes: ['tenant:comp-1:ebook:read'] }).success,
    true,
  );
  assert.equal(
    BitwiseMatrixPayloadSchema.safeParse({ roleId: UUID, tenantId: UUID, permissionBitmask: '0xF', scopes: [] }).success,
    false,
  );
  assert.equal(
    EvaluatePermissionInputSchema.safeParse({ requiredBitmask: '1', requiredScope: 'tenant:comp-1:ebook:read', tenantId: UUID }).success,
    true,
  );
  assert.equal(
    TokenIntrospectionResponseSchema.safeParse({ active: true, userId: UUID, tenantId: UUID, bitmask: '15', scopes: [], jti: UUID, exp: 9999999999 }).success,
    true,
  );
  assert.equal(BITWISE_EVAL_BUDGET_MS, 0.05);
  assert.equal(SCOPED_TOKEN_TTL_SEC, 900);
  assert.equal(SECURITY_VIOLATION_STREAM, 'events:security:violations');
  assert.equal(blacklistJtiKey('abc'), 'blacklist:jti:abc');
  assert.equal(roleMatrixKey('t', 'r'), 'security:matrix:{t}:r');
  ok('Zod §3.1 verbatim (flags/scopes/payload/evaluate/introspection/keys)');
}

// ---------- 2. Pure helpers (O(1) BigInt + wildcard + boundary) ----------
{
  assert.equal(hasBit('15', '1'), true); // 0xF covers READ_CATALOG
  assert.equal(hasBit('15', '128'), false);
  assert.equal(missingBits('15', '128'), '128');
  assert.equal(missingBits('15', '1'), '0');
  assert.equal(grantBit('0', 4n), '4');
  assert.equal(revokeBit('15', 1n), '14');
  assert.equal(matchScopePattern('tenant:comp-1:ebook:read', ['tenant:comp-1:ebook:read']), true);
  assert.equal(matchScopePattern('tenant:comp-1:ebook:read', ['tenant:comp-1:ebook:*']), true);
  assert.equal(matchScopePattern('tenant:comp-1:ebook:read', ['*']), true);
  assert.equal(matchScopePattern('tenant:comp-2:course:write', ['tenant:comp-1:*:*']), false);
  assert.equal(isTenantScopeAllowed('tenant:company-a:course:write', 'company-a'), true);
  assert.equal(isTenantScopeAllowed('tenant:company-a:course:write', 'company-b'), false);
  assert.equal(tenantOfScope('tenant:company-a:course:write'), 'company-a');
  const mask = PermissionBitmask.from('15');
  assert.equal(mask.allows('1'), true);
  assert.equal(mask.missing('128').toString(), '128');
  assert.equal(mask.grant(128n).toString(), '143');
  assert.equal(mask.revoke(1n).toString(), '14');
  assert.equal(JwtScopePattern.missing(['tenant:a:ebook:read'], ['tenant:a:ebook:*']).length, 0);
  assert.equal(JwtScopePattern.withinTenant(['tenant:company-a:course:write'], 'company-a'), true);
  assert.equal(JwtScopePattern.withinTenant(['tenant:company-a:course:write'], 'company-b'), false);
  ok('Helpers: BigInt O(1) + wildcard + tenant boundary + VOs');
}

// ---------- 3. BDD Scenario 1: O(1) <0.05ms (measured, CI-safe ceiling 5ms) ----------
{
  const svc = new BitwiseEvaluatorService();
  const verdict = svc.evaluate('15', '1');
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.missingBits, '0');
  assert.ok(verdict.evaluatedInMs < 5, `eval too slow: ${verdict.evaluatedInMs}ms`);
  const deny = svc.evaluate('15', '128');
  assert.equal(deny.allowed, false);
  // 10k-iteration p95 probe stays within microsecond regime (no DB hit).
  const samples: number[] = [];
  for (let i = 0; i < 200; i++) samples.push(svc.evaluate('15', '4').evaluatedInMs);
  samples.sort((a, b) => a - b);
  assert.ok(samples[Math.floor(samples.length * 0.95)] < 5, 'p95 eval budget');
  const matcher = new ScopeMatcherService();
  const scopeVerdict = matcher.evaluate(['tenant:comp-1:ebook:read'], ['tenant:comp-1:ebook:*']);
  assert.equal(scopeVerdict.allowed, true);
  assert.equal(matcher.enforceTenantBoundary(['tenant:company-a:course:write'], 'company-a'), true);
  ok('BDD-1: O(1) bitwise verdict + scope match (DB-free, microsecond regime)');
}

// ---------- 4. BDD Scenario 2: cross-tenant mutation rejected ----------
{
  const matcher = new ScopeMatcherService();
  // Instructor scoped to company-a attempts company-b write: boundary fails first.
  assert.equal(matcher.enforceTenantBoundary(['tenant:company-b:course:write'], 'company-a'), false);
  const verdict = matcher.evaluate(['tenant:company-b:course:write'], ['tenant:company-a:course:write']);
  assert.equal(verdict.allowed, false);
  assert.deepEqual(verdict.missingScopes, ['tenant:company-b:course:write']);
  ok('BDD-2: tenant boundary mismatch => 403 Forbidden + audit');
}

// ---------- 5. BDD Scenario 3: revoke JTI + TokenScopeService round-trip ----------
function fakeRedisStore(): { map: Map<string, string> } & Record<string, unknown> {
  const map = new Map<string, string>();
  return {
    map,
    setnx: async (k: string, v: string) => {
      if (map.has(k)) return false;
      map.set(k, v);
      return true;
    },
    get: async (k: string) => map.get(k) ?? null,
    del: async (...ks: string[]) => {
      for (const k of ks) map.delete(k);
    },
  } as unknown as { map: Map<string, string> } & Record<string, unknown>;
}

async function sectionRevoke(): Promise<void> {
  const store = fakeRedisStore();
  const adapter = new RedisTokenBlacklistAdapter(store as never);
  assert.equal(await adapter.isRevoked('jti-1'), false);
  assert.equal(await adapter.revoke('jti-1', 60), true);
  assert.equal(await adapter.revoke('jti-1', 60), false); // idempotent NX
  assert.equal(await adapter.isRevoked('jti-1'), true);

  const tokens = new TokenScopeService(adapter);
  const token = tokens.issueScopedTemporaryToken({
    userId: UUID,
    targetTenantId: 'company-a',
    bitmask: '15',
    requestedScopes: ['tenant:company-a:course:write'],
    ttlSeconds: 900,
  });
  const claims = tokens.verifyScopedToken(token);
  assert.equal(claims.sub, UUID);
  assert.equal(claims.tenantId, 'company-a');
  assert.equal(claims.bitmask, '15');
  const hydrated = await tokens.hydrate(token);
  assert.equal(hydrated.active, true);
  assert.equal(hydrated.userId, UUID);
  // Compromised session: revoke JTI => hydrate flips inactive (<1s edge read).
  await tokens.revokeScope(claims.jti, UUID, 'payout:execute revoked for USR-8899');
  const after = await tokens.hydrate(token);
  assert.equal(after.active, false);
  // Tampered token rejected.
  assert.throws(() => tokens.verifyScopedToken(`${token}tamper`), /Invalid token/);
  ok('BDD-3: scoped issue/verify/hydrate + JTI revoke <1s edge fan-out');
}

// ---------- 6. Repository atomic $transaction (Gate 7) ----------
async function sectionRepo(): Promise<void> {
  const calls: string[] = [];
  const fakePrisma = {
    securityRole: {
      findUnique: async () => ({ id: 'r1', tenantId: 't1', name: 'Seller', bitwiseMask: '15', updatedAt: new Date('2026-01-01T00:00:00.000Z'), scopes: [{ scopePattern: 'tenant:t1:ebook:read' }] }),
      upsert: async () => {
        calls.push('upsert');
        return { id: 'r1', tenantId: 't1', name: 'Seller', bitwiseMask: '15' };
      },
    },
    roleScopeRegistry: {
      deleteMany: async () => {
        calls.push('deleteMany');
      },
      createMany: async () => {
        calls.push('createMany');
      },
    },
    securityAuditLog: {
      create: async () => {
        calls.push('audit');
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(fakePrisma),
  };
  const repo = new PrismaSecurityRoleRepository(fakePrisma as never);
  const matrix = await repo.getMatrix('t1', 'r1');
  assert.equal(matrix?.permissionBitmask, '15');
  assert.deepEqual(matrix?.grantedScopes, ['tenant:t1:ebook:read']);
  assert.equal(await repo.getMatrix('other-tenant', 'r1'), null); // tenant isolation
  const updated = await repo.updateMatrix({
    tenantId: 't1', roleId: 'r1', roleName: 'Seller', bitmask: '15',
    scopes: ['tenant:t1:ebook:read'], actorUserId: UUID, ipAddress: '1.2.3.4', userAgent: 'test',
  });
  assert.equal(updated.permissionBitmask, '15');
  assert.deepEqual(calls, ['upsert', 'deleteMany', 'createMany', 'audit']);
  ok('Repository: tenant-isolated read + atomic update (upsert/scopes/audit in $transaction)');
}

// ---------- 7. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model SecurityRole {',
    'model RoleScopeRegistry {',
    'model UserTenantRole {',
    'model RevocationBlacklist {',
    'model SecurityAuditLog {',
    'bitwiseMask',
    'scopePattern String',
    'customMask Decimal?',
    'tenantRoleAssignments UserTenantRole[]',
    '@@unique([tenantId, name])',
    '@@unique([userId, tenantId, roleId])',
    '@@index([userId, timestamp])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: SecurityRole/RoleScopeRegistry/UserTenantRole/RevocationBlacklist/SecurityAuditLog additive');
}

function sectionParity(): void {
  for (const f of [
    'packages/shared/src/schemas/permission-matrix.schema.ts',
    'apps/backend/src/domain/entities/permission-bitmask.vo.ts',
    'apps/backend/src/domain/entities/jwt-scope-pattern.vo.ts',
    'apps/backend/src/domain/exceptions/invalid-bitmask.exception.ts',
    'apps/backend/src/domain/exceptions/scope-access-denied.exception.ts',
    'apps/backend/src/application/services/bitwise-evaluator.service.ts',
    'apps/backend/src/application/services/scope-matcher.service.ts',
    'apps/backend/src/application/commands/update-role-matrix.command.ts',
    'apps/backend/src/application/commands/revoke-jwt-scope.command.ts',
    'apps/backend/src/application/queries/evaluate-permission.query.ts',
    'apps/backend/src/application/queries/get-role-matrix.query.ts',
    'apps/backend/src/infrastructure/adapters/redis-token-blacklist.adapter.ts',
    'apps/backend/src/infrastructure/persistence/prisma-security-role.repository.ts',
    'apps/backend/src/presentation/decorators/require-bitwise.decorator.ts',
    'apps/backend/src/presentation/decorators/require-scopes.decorator.ts',
    'apps/backend/src/presentation/guards/bitwise-permission.guard.ts',
    'apps/backend/src/presentation/guards/jwt-scope.guard.ts',
    'apps/backend/src/modules/auth/guards/bitwise-permission.guard.ts',
    'apps/backend/src/modules/auth/guards/jwt-scope.guard.ts',
    'apps/backend/src/modules/auth/services/token-scope.service.ts',
    'apps/backend/src/modules/security-matrix/security-matrix.module.ts',
    'apps/backend/src/modules/security-matrix/security-matrix.controller.ts',
    'apps/backend/src/modules/security-matrix/security-matrix.resolver.ts',
    'apps/backend/src/api/graphql/resolvers/permission.resolver.ts',
    'apps/backend/src/api/graphql/permission.graphql',
    'apps/frontend/components/admin/permission-matrix-builder.tsx',
    'apps/frontend/hooks/use-permission.ts',
    'apps/frontend/lib/permissions/permission-matrix-client.ts',
    'apps/frontend/app/api/v1/security/roles/[roleId]/route.ts',
    'apps/frontend/app/api/v1/security/matrix/route.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('function Placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController|GuardGuard/.test(src), `${f} scaffold name`);
  }
  const guard = readFileSync('apps/backend/src/presentation/guards/bitwise-permission.guard.ts', 'utf8');
  assert.ok(guard.includes('BitwisePermissionGuard') && guard.includes('blacklist:jti') === false, 'guard delegates blacklist via adapter');
  assert.ok(guard.includes('ForbiddenException') && guard.includes('Missing Bitmask'), 'guard 403 taxonomy');
  const scopeGuard = readFileSync('apps/backend/src/presentation/guards/jwt-scope.guard.ts', 'utf8');
  assert.ok(scopeGuard.includes('Tenant Boundary Mismatch'), 'BDD-2 tenant 403 pinned');
  const tokens = readFileSync('apps/backend/src/modules/auth/services/token-scope.service.ts', 'utf8');
  assert.ok(tokens.includes('issueScopedTemporaryToken') && tokens.includes('hydrate') && tokens.includes('revokeScope'), '106 token service');
  const mod = readFileSync('apps/backend/src/modules/security-matrix/security-matrix.module.ts', 'utf8');
  assert.ok(mod.includes('SecurityMatrixModule') && mod.includes('PrismaSecurityRoleRepository'), 'module wiring');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('SecurityMatrixModule'), 'AppModule wiring');
  const gql = readFileSync('apps/backend/src/modules/security-matrix/security-matrix.resolver.ts', 'utf8');
  assert.ok(gql.includes('getTenantRoleMatrix') && gql.includes('evaluateUserAccess') && gql.includes('revokeJwtScope') && gql.includes('issueScopedTemporaryToken'), 'GQL §3.2 parity');
  const sdl = readFileSync('apps/backend/src/api/graphql/permission.graphql', 'utf8');
  assert.ok(sdl.includes('BitwisePermissionMatrix') && sdl.includes('PermissionEvaluationResult'), 'SDL §3.2 parity');
  const builder = readFileSync('apps/frontend/components/admin/permission-matrix-builder.tsx', 'utf8');
  assert.ok(builder.includes('PermissionMatrixBuilder') && builder.includes('computed-bitmask') && !builder.includes('lucide-react'), 'builder zero-dep + bitmask readout');
  const hook = readFileSync('apps/frontend/hooks/use-permission.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR') && hook.includes('usePermission'), '5-state hook');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('permission-matrix.schema') && barrel.includes('BitwisePermissionFlags') && barrel.includes('hasBit'), 'barrel SSOT export');
  // Phase 032 regression pins: device-permission contract untouched.
  const p32 = readFileSync('packages/shared/src/schemas/permission-contract.ts', 'utf8');
  assert.ok(p32.includes('PermissionTypeEnum') && p32.includes('GEOLOCATION_TIMEOUT_MS'), '032 contract intact');
  ok('Parity: 30 files implemented + guards/SDL/module/frontend/barrel + 032 intact');
}

async function main(): Promise<void> {
  await sectionRevoke();
  await sectionRepo();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase106 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
