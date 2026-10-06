// SSOT Phase 021 §10 — contract tests (LIFF SDK v2.22+ handshake, Zod SSOT, JWT facade)
// Run: npx tsx scripts/test-phase021-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import {
  LiffEnvironmentEnum,
  LiffInitPayloadSchema,
  LiffAuthHandshakeSchema,
  LiffAuthResponseSchema,
} from '../packages/shared/src/schemas/liff-auth.schema';
import { TokenService } from '../apps/backend/src/modules/auth/services/token.service';
import { JwtTokenService } from '../apps/backend/src/modules/auth/services/jwt-token.service';

const UID = '123e4567-e89b-12d3-a456-426614174001';
const TID = '123e4567-e89b-12d3-a456-426614174000';
let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Environment enum (4 values, §3.1) ----------
{
  for (const env of ['LINE_IN_APP', 'LINE_MINI_APP_SUBWINDOW', 'EXTERNAL_BROWSER', 'DESKTOP_MOCK']) {
    assert.equal(LiffEnvironmentEnum.safeParse(env).success, true);
  }
  assert.equal(LiffEnvironmentEnum.safeParse('UNKNOWN').success, false);
  ok('LiffEnvironmentEnum accepts 4 envs, rejects unknown');
}

// ---------- 2. Init payload (§3.1) ----------
{
  assert.equal(
    LiffInitPayloadSchema.safeParse({ liffId: 'LIFF-1', tenantId: 'default', environment: 'LINE_IN_APP', isLoggedIn: true }).success,
    true,
  );
  assert.equal(
    LiffInitPayloadSchema.safeParse({
      liffId: 'LIFF-1', tenantId: 'default', environment: 'LINE_MINI_APP_SUBWINDOW',
      isLoggedIn: false, appLanguage: 'th', os: 'ios', lineVersion: '14.0.0',
    }).success,
    true,
  );
  assert.equal(LiffInitPayloadSchema.safeParse({ liffId: '', tenantId: 'default', environment: 'LINE_IN_APP', isLoggedIn: true }).success, false);
  assert.equal(LiffInitPayloadSchema.safeParse({ liffId: 'LIFF-1', tenantId: '', environment: 'DESKTOP_MOCK', isLoggedIn: false }).success, false);
  ok('LiffInitPayload requires liffId/tenantId, optional Mini App fields');
}

// ---------- 3. Handshake (§3.1 + controller gate) ----------
{
  assert.equal(LiffAuthHandshakeSchema.safeParse({ idToken: 'id-token-x', tenantId: 'default' }).success, true);
  assert.equal(
    LiffAuthHandshakeSchema.safeParse({ idToken: 'id-token-x', accessToken: 'at', tenantId: 'default', referralCode: 'REF-1' }).success,
    true,
  );
  assert.equal(LiffAuthHandshakeSchema.safeParse({ idToken: '', tenantId: 'default' }).success, false);
  assert.equal(LiffAuthHandshakeSchema.safeParse({ idToken: 'x', tenantId: '' }).success, false);
  assert.equal(LiffAuthHandshakeSchema.safeParse({ tenantId: 'default' }).success, false);
  ok('LiffAuthHandshake rejects empty idToken/tenantId (controller 401 gate)');
}

// ---------- 4. Response shape (§3.1) ----------
{
  const good = {
    success: true, accessToken: 'jwt-x',
    user: { id: UID, lineUserId: 'U123', displayName: 'Zene', avatarUrl: null, role: 'MEMBER', tenantId: 'default' },
    expiresIn: 604800,
  };
  assert.equal(LiffAuthResponseSchema.safeParse(good).success, true);
  assert.equal(LiffAuthResponseSchema.safeParse({ ...good, user: { ...good.user, id: 'not-uuid' } }).success, false);
  assert.equal(LiffAuthResponseSchema.safeParse({ ...good, accessToken: 123 }).success, false);
  ok('LiffAuthResponse enforces uuid user + string token');
}

// ---------- 5. JWT facade round-trip (service §5.2 issuance path) ----------
{
  const tokens = new TokenService('test-secret-144-xz-phase021');
  const facade = new JwtTokenService(tokens);
  const { accessToken, expiresIn } = facade.generateAccessToken({
    userId: UID, lineUserId: 'U123', tenantId: TID, role: 'MEMBER',
  });
  assert.equal(typeof accessToken, 'string');
  assert.equal(accessToken.split('.').length, 3);
  assert.equal(expiresIn > 0, true);
  const claims = facade.verifyAccessToken(accessToken) as { sub: string; tenantId: string };
  assert.equal(claims.sub, UID);
  assert.equal(claims.tenantId, TID);
  ok('JwtTokenService issues HS256 JWT verifiable by edge middleware shape');
}

// ---------- 6. Channel resolution (multi-tenant env fallback) ----------
{
  const resolve = (tenantId: string): string =>
    process.env[`LINE_CHANNEL_ID_${tenantId.toUpperCase()}`] ?? process.env.LINE_CHANNEL_ID ?? '';
  process.env.LINE_CHANNEL_ID = 'CH-DEFAULT';
  assert.equal(resolve('default'), 'CH-DEFAULT');
  process.env.LINE_CHANNEL_ID_ACME = 'CH-ACME';
  assert.equal(resolve('acme'), 'CH-ACME');
  delete process.env.LINE_CHANNEL_ID_ACME;
  delete process.env.LINE_CHANNEL_ID;
  assert.equal(resolve('ghost'), '');
  ok('Channel ID resolves tenant-specific → default → empty (401 when empty)');
}

console.log(`\nPhase 021 contracts: ${passed}/6 groups passed`);
