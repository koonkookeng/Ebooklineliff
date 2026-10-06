// SSOT Phase 005 §10.1 + Phase 006 §10 — AuthService integration spec (node:test, zero-dep)
// Full matrix also runs in scripts/test-phase00{5,6}-contracts.ts loop 3x.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineLiffAuthInputSchema, LiffAuthInputSchema, JwtPayloadSchema } from '@repo/shared';
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

  it('validates Phase 006 LIFF input shape (deviceInfo + referral)', () => {
    const t0 = performance.now();
    const parsed = LiffAuthInputSchema.safeParse({
      idToken: 'x'.repeat(32),
      tenantId: TID,
      referralCode: 'REF-EMERALD-999',
      deviceInfo: { os: 'iOS', ipAddress: '1.2.3.4' },
    });
    assert.equal(parsed.success, true);
    assert.equal(
      LiffAuthInputSchema.safeParse({ idToken: 'x'.repeat(32), tenantId: TID, deviceInfo: { ipAddress: 'nope' } }).success,
      false,
    );
    assert.ok(performance.now() - t0 < 300);
  });

  it('validates Phase 007 QR envelope + risk threshold', async () => {
    const { sealEnvelope, openEnvelope } = await import('./qr-sync/domain/value-objects/ephemeral-nonce.vo');
    const { scoreQrRisk, requiresPin } = await import('./qr-sync/domain/entities/qr-session.entity');
    const t0 = performance.now();
    const qrToken = '123e4567-e89b-12d3-a456-426614174002';
    const env = sealEnvelope({ qrToken, nonce: 'n'.repeat(64), exp: Math.floor(Date.now() / 1000) + 60 });
    assert.equal(openEnvelope(env, qrToken).qrToken, qrToken);
    assert.throws(() => openEnvelope(env, TID));
    assert.ok(!requiresPin(scoreQrRisk({ desktopIp: '1.1.1.1', mobileIp: '1.1.1.1', fingerprintKnown: true, attempts: 0 })));
    assert.ok(requiresPin(scoreQrRisk({ desktopIp: '1.1.1.1', mobileIp: '2.2.2.2', fingerprintKnown: false, attempts: 0 })));
    assert.ok(performance.now() - t0 < 500);
  });
});
