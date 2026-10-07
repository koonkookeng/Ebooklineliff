// SSOT Phase 035 Task 2 — MiniApp handshake verifier (scope + budget gate)
// Canonical: apps/backend/src/modules/auth/line-miniapp-verifier.service.ts
// (legacy src/backend/modules/auth/line-miniapp-verifier.service.ts)
// - verifyHandshake: pure check used by the sandbox runner pre-gate and
//   available to the auth pipeline (minimal scopes + handshake budget).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { HANDSHAKE_BUDGET_MS } from '@repo/shared';

const MINIMAL_SCOPES = ['openid', 'profile'];

export interface HandshakeEvidence {
  requestedScopes: string[];
  handshakeMs?: number;
}

export interface HandshakeVerdict {
  scopesMinimal: boolean;
  withinBudget: boolean;
  passed: boolean;
}

/** Pure handshake gate (unit-tested without Nest). */
export function verifyHandshake(evidence: HandshakeEvidence): HandshakeVerdict {
  const scopesMinimal =
    evidence.requestedScopes.length > 0 && evidence.requestedScopes.every((s) => MINIMAL_SCOPES.includes(s));
  const withinBudget = typeof evidence.handshakeMs === 'number' && evidence.handshakeMs < HANDSHAKE_BUDGET_MS;
  return { scopesMinimal, withinBudget, passed: scopesMinimal && withinBudget };
}

@Injectable()
export class LineMiniappVerifierService {
  verify(evidence: HandshakeEvidence): HandshakeVerdict {
    return verifyHandshake(evidence);
  }
}
