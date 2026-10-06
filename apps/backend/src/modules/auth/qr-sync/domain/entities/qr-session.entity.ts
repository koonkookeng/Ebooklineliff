// SSOT Phase 007 §2.2/§5.1 — QR session entity (pure state machine + risk scoring, no I/O)
// Canonical: apps/backend/src/modules/auth/qr-sync/domain/entities/qr-session.entity.ts
// States: PENDING -> SCANNED -> AUTHORIZED | REJECTED ; any -> EXPIRED on TTL lapse.
import type { QrSessionStatus } from '@repo/shared';

export const QR_TTL_SEC = 60;
export const RISK_PIN_THRESHOLD = 80;

const TRANSITIONS: Record<QrSessionStatus, QrSessionStatus[]> = {
  PENDING: ['SCANNED', 'AUTHORIZED', 'REJECTED', 'EXPIRED'],
  SCANNED: ['AUTHORIZED', 'REJECTED', 'EXPIRED'],
  AUTHORIZED: ['EXPIRED'],
  REJECTED: ['EXPIRED'],
  EXPIRED: [],
};

export function canTransition(from: QrSessionStatus, to: QrSessionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: QrSessionStatus, to: QrSessionStatus): void {
  if (!canTransition(from, to)) throw new Error(`INVALID_QR_TRANSITION:${from}->${to}`);
}

export interface RiskSignals {
  desktopIp: string | null;
  mobileIp: string | null;
  fingerprintKnown: boolean;
  attempts: number;
}

/** AI-risk heuristic v1 (deterministic, testable): 0-100. ≥80 forces 6-digit PIN step-up. */
export function scoreQrRisk(signals: RiskSignals): number {
  let score = 0;
  // Cross-device IP mismatch is the primary anomaly signal (impossible-travel proxy)
  if (signals.desktopIp && signals.mobileIp && signals.desktopIp !== signals.mobileIp) score += 65;
  if (!signals.fingerprintKnown) score += 20;
  if (signals.attempts >= 3) score += 30;
  else if (signals.attempts === 2) score += 10;
  return Math.min(100, score);
}

export function requiresPin(score: number): boolean {
  return score >= RISK_PIN_THRESHOLD;
}
