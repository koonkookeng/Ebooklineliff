// SSOT Phase 035 Task 2 — Auth/security/consent/navigation checkers (BDD Sc. 2)
// Canonical: apps/backend/src/modules/line-sandbox/checkers/auth-security.checker.ts
// (legacy src/backend/modules/line-sandbox/checkers/auth-security.checker.ts)
// - AUTHENTICATION_SECURITY: minimal scopes {profile, openid} + handshake <400ms.
// - PRIVACY_CONSENT: explicit ToS + Privacy checkboxes verified.
// - UI_NAVIGATION_COMPLIANCE: native LINE header visible + first paint <1.5s.
// - Missing signals fail closed (unmeasured ≠ compliant, Gate 4).
// - Zero new deps.
import { FIRST_PAINT_BUDGET_MS, HANDSHAKE_BUDGET_MS, type SandboxSignals } from '@repo/shared';
import type { CheckerResult } from './checker.types';

const MINIMAL_SCOPES = ['openid', 'profile'];

export function checkAuthSecurity(signals: SandboxSignals): CheckerResult[] {
  const scopes = signals.requestedScopes ?? [];
  const minimal = scopes.length > 0 && scopes.every((s) => MINIMAL_SCOPES.includes(s));
  const handshake = signals.handshakeMs;
  const handshakePassed = typeof handshake === 'number' && handshake < HANDSHAKE_BUDGET_MS;
  const consent = signals.consentChecked;
  const consentPassed = consent?.terms === true && consent?.privacy === true;
  const navPassed = signals.nativeHeaderVisible === true;
  const paint = signals.firstPaintMs;
  const paintPassed = typeof paint === 'number' && paint < FIRST_PAINT_BUDGET_MS;
  return [
    {
      category: 'AUTHENTICATION_SECURITY',
      checkPointName: 'Minimal OAuth scopes (profile + openid only)',
      isPassed: minimal,
      memoryUsageMB: 0,
      ...(minimal ? {} : { diagnosticMessage: `Requested [${scopes.join(', ') || 'none'}] — strip to profile/openid` }),
    },
    {
      category: 'AUTHENTICATION_SECURITY',
      checkPointName: 'ID Token exchange under 400ms',
      isPassed: handshakePassed,
      memoryUsageMB: 0,
      ...(handshakePassed ? {} : { diagnosticMessage: `Handshake ${handshake ?? 'unmeasured'}ms — edge-verify the token` }),
    },
    {
      category: 'PRIVACY_CONSENT',
      checkPointName: 'Explicit ToS + Privacy Policy consent',
      isPassed: consentPassed,
      memoryUsageMB: 0,
      ...(consentPassed ? {} : { diagnosticMessage: 'Require checked ToS + Privacy checkboxes before login' }),
    },
    {
      category: 'UI_NAVIGATION_COMPLIANCE',
      checkPointName: 'LINE native header visible + first paint under 1.5s',
      isPassed: navPassed && paintPassed,
      memoryUsageMB: 0,
      ...(navPassed && paintPassed ? {} : { diagnosticMessage: 'Keep native header uncovered; cut first paint below 1500ms' }),
    },
  ];
}
