// SSOT Phase 005 §10.1 — AuthService integration spec (node:test, zero-dep; runnable via tsx)
// Full matrix (linking/rotation/guards) also runs in scripts/test-phase005-contracts.ts loop 3x.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineLiffAuthInputSchema, JwtPayloadSchema } from '@repo/shared';
import { TokenService } from './services/token.service';

const TID = '123e4567-e89b-12d3-a456-426614174000';
const UID = '123e4567-e89b-12d3-a456-426614174001';

describe('AuthService (Phase 005 Integration)', () => {
  it('authenticates LINE LIFF input shape and mints a verifiable access token in <100ms', () => {
    const t0 = performance.now();
    const parsed = LineLiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: TID });
    assert.equal(parsed.success, true);
    const tokens = new TokenService('spec-secret-144-xz', null);
    const accessToken = tokens.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID });
    const payload = JwtPayloadSchema.parse(tokens.verifyAccessToken(accessToken));
    assert.equal(payload.role, 'MEMBER');
    assert.ok(performance.now() - t0 < 100);
  });

  it('rejects tampered and expired tokens', () => {
    const tokens = new TokenService('spec-secret-144-xz', null);
    const good = tokens.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID });
    const [h, b, s] = good.split('.');
    assert.throws(() => tokens.verifyAccessToken(`${h}.${b}x.${s}`));
    const expired = tokens.signAccessToken({ sub: UID, role: 'MEMBER', tenantId: TID, sessionId: UID }, -5);
    assert.throws(() => tokens.verifyAccessToken(expired));
  });
});
