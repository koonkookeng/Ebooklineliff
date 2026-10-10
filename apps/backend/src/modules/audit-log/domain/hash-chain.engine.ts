// SSOT Phase 118 Task 3 §5.2 — hash-chain engine (pure, deterministic)
// Canonical: apps/backend/src/modules/audit-log/domain/hash-chain.engine.ts
// (legacy src/backend/modules/audit-log/domain/hash-chain.engine.ts)
// - Thin domain facade over the SSOT contract primitives (auditBlockHash):
//   same formula, single implementation (Zero Redundant).
// - verifyWindow replays an ordered block window and reports the first
//   break (fail-closed). Pure. Zero new deps.
import { Injectable } from '@nestjs/common';
import { AUDIT_GENESIS_HASH, auditBlockHash } from '@repo/shared';

export interface AuditBlock {
  sequenceNumber: number | bigint;
  actorId: string;
  actionName: string;
  payloadBefore: unknown;
  payloadAfter: unknown;
  previousHash: string;
  currentHash: string;
  timestamp: string;
}

export function calculateBlockHash(args: {
  sequenceNumber: number | bigint;
  actorId: string;
  actionName: string;
  payloadBefore: unknown;
  payloadAfter: unknown;
  previousHash: string;
  timestamp: string;
}): string {
  return auditBlockHash(args);
}

/** Replay an oldest-first window; fail-closed break report. */
export function verifyWindow(blocks: AuditBlock[]): { valid: boolean; checked: number; brokenAt?: number | bigint } {
  const ordered = [...blocks].sort((a, b) => Number(BigInt(a.sequenceNumber) - BigInt(b.sequenceNumber)));
  let prev = AUDIT_GENESIS_HASH;
  for (const b of ordered) {
    if (b.previousHash !== prev) return { valid: false, checked: 0, brokenAt: b.sequenceNumber };
    const expect = calculateBlockHash({
      sequenceNumber: b.sequenceNumber,
      actorId: b.actorId,
      actionName: b.actionName,
      payloadBefore: b.payloadBefore,
      payloadAfter: b.payloadAfter,
      previousHash: b.previousHash,
      timestamp: b.timestamp,
    });
    if (expect !== b.currentHash) return { valid: false, checked: 0, brokenAt: b.sequenceNumber };
    prev = b.currentHash;
  }
  return { valid: true, checked: ordered.length };
}

@Injectable()
export class HashChainEngine {
  calculate = calculateBlockHash;
  verify = verifyWindow;
  genesis(): string {
    return AUDIT_GENESIS_HASH;
  }
}
