// SSOT Phase 120 Task 5 §7.1 — multi-factor risk calculator (pure core)
// Canonical: apps/backend/src/modules/security/services/risk-calculator.service.ts
// (legacy src/backend/modules/security/services/risk-calculator.service.ts)
// - evaluate(signals): additive anomalyScore → IpRiskLevel → mfa/session
//   verdicts + dominant anomalyType (impossible > vpn > rotation > country
//   > device > normal). Pure; the injectable shell exists for module wiring.
// - Distinct from 119's device fraudScore (login-velocity lane vs
//   device-session lane — different signals, documented).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  anomalyScore,
  mfaRequired,
  scoreToLevel,
  sessionBlocked,
  type AnomalySignals,
  type IpAnomalyType,
  type IpRiskLevel,
} from '@repo/shared';

export interface RiskEvaluation {
  anomalyType: IpAnomalyType;
  riskLevel: IpRiskLevel;
  riskScore: number;
  mfaRequired: boolean;
  sessionBlocked: boolean;
}

/** Dominant anomaly classification (precedence-ordered). */
export function classifyAnomaly(signals: AnomalySignals): IpAnomalyType {
  if (signals.impossibleTravel) return 'IMPOSSIBLE_TRAVEL';
  if (signals.knownVpnProxy) return 'KNOWN_VPN_PROXY';
  if (signals.highVelocityRotation) return 'HIGH_VELOCITY_ROTATION';
  if (signals.newCountry) return 'NEW_COUNTRY';
  if (signals.deviceMismatch) return 'DEVICE_FINGERPRINT_MISMATCH';
  return 'NORMAL';
}

export function evaluateRisk(signals: AnomalySignals): RiskEvaluation {
  const riskScore = anomalyScore(signals);
  const riskLevel = scoreToLevel(riskScore);
  return {
    anomalyType: riskScore === 0 ? 'NORMAL' : classifyAnomaly(signals),
    riskLevel,
    riskScore,
    mfaRequired: mfaRequired(riskLevel),
    sessionBlocked: sessionBlocked(riskScore),
  };
}

@Injectable()
export class RiskCalculatorService {
  evaluate = evaluateRisk;
  classify = classifyAnomaly;
}
