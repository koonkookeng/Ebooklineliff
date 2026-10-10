// SSOT Phase 115 Task 4 §5.2 — matching strategies (pure, deterministic)
// Canonical: apps/backend/src/modules/reconciliation/services/matching-strategy.service.ts
// (legacy src/backend/modules/reconciliation/services/matching-strategy.service.ts)
// - Strategy A EXACT_TRANS_REF (score 100): slip transRef equality +
//   cents-exact amount equality.
// - Strategy B AMOUNT_TIME_WINDOW_UNIQUE (score 95): exactly one
//   PENDING_PAYMENT order with equal amount inside the tolerance window.
// - Ambiguity (>1 candidate → 50/AMBIGUOUS) and miss (0/NONE) are explicit
//   verdicts, never silent.
// - screenAnomaly (§7.1): micro-transfer layering (≥5 same-amount credits
//   in 10 min) + transRef replay (same ref already VERIFIED) →
//   SUSPICIOUS_PATTERN. Pure over caller-supplied windows (DB-free, tested).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { windowBounds } from '@repo/shared';

const toCents = (n: number | string): number => Math.round(Number(n) * 100);

export interface SlipCandidate {
  transRef: string | null;
  amount: number | string;
  orderId: string;
}

export interface OrderCandidate {
  id: string;
  netAmount: number | string;
  createdAt: Date;
}

export type MatchVerdict =
  | { kind: 'EXACT'; orderId: string; score: 100; algorithm: 'EXACT_TRANS_REF' }
  | { kind: 'WINDOW_UNIQUE'; orderId: string; score: 95; algorithm: 'AMOUNT_TIME_WINDOW_UNIQUE' }
  | { kind: 'AMBIGUOUS'; score: 50; algorithm: 'AMBIGUOUS_CANDIDATES' }
  | { kind: 'MISS'; score: 0; algorithm: 'NONE' };

/** Strategy A: exact transRef + cents-exact amount. */
export function matchByTransRef(
  statement: { transRef: string | null; amount: number | string },
  slip: SlipCandidate | null,
): MatchVerdict | null {
  if (!statement.transRef || !slip) return null;
  if (slip.transRef !== statement.transRef) return null;
  if (toCents(slip.amount) !== toCents(statement.amount)) return null;
  return { kind: 'EXACT', orderId: slip.orderId, score: 100, algorithm: 'EXACT_TRANS_REF' };
}

/** Strategy B: unique amount+window candidate among PENDING orders. */
export function matchByAmountWindow(
  statement: { amount: number | string; txTimestamp: Date | string },
  candidates: OrderCandidate[],
  toleranceMins: number,
): MatchVerdict {
  const { minTime, maxTime } = windowBounds(statement.txTimestamp, toleranceMins);
  const inWindow = candidates.filter(
    (c) => toCents(c.netAmount) === toCents(statement.amount) && c.createdAt >= minTime && c.createdAt <= maxTime,
  );
  if (inWindow.length === 1) {
    return { kind: 'WINDOW_UNIQUE', orderId: inWindow[0]!.id, score: 95, algorithm: 'AMOUNT_TIME_WINDOW_UNIQUE' };
  }
  if (inWindow.length > 1) return { kind: 'AMBIGUOUS', score: 50, algorithm: 'AMBIGUOUS_CANDIDATES' };
  return { kind: 'MISS', score: 0, algorithm: 'NONE' };
}

export interface TransferSignal {
  senderName: string | null;
  amount: number | string;
  at: Date;
}

/**
 * Layering/replay screen over a recent caller-supplied window:
 * ≥5 same-amount credits from one sender in 10 minutes, or a transRef
 * already consumed by a VERIFIED slip.
 */
export function screenAnomaly(args: {
  transRef: string;
  amount: number | string;
  senderName: string | null;
  recent: TransferSignal[];
  verifiedSlipRefs: string[];
}): { suspicious: boolean; reason: 'MICRO_TRANSFER_LAYERING' | 'REPLAY_TRANS_REF' | null } {
  if (args.verifiedSlipRefs.includes(args.transRef)) {
    return { suspicious: true, reason: 'REPLAY_TRANS_REF' };
  }
  const windowStart = Date.now() - 10 * 60000;
  const same = args.recent.filter(
    (r) => (r.senderName ?? '') === (args.senderName ?? '') && toCents(r.amount) === toCents(args.amount) && r.at.getTime() >= windowStart,
  );
  if (same.length >= 5) return { suspicious: true, reason: 'MICRO_TRANSFER_LAYERING' };
  return { suspicious: false, reason: null };
}

@Injectable()
export class MatchingStrategyService {
  byTransRef = matchByTransRef;
  byAmountWindow = matchByAmountWindow;
  anomaly = screenAnomaly;
}
