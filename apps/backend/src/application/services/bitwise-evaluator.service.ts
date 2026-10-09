// SSOT Phase 106 Task 3 — BitwiseEvaluatorService (O(1) <0.05ms, no DB hit)
// Canonical: apps/backend/src/application/services/bitwise-evaluator.service.ts
// - Pure BigInt AND; latency measured by caller (evaluateUserAccess returns evaluatedInMs).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PermissionBitmask } from '../../domain/entities/permission-bitmask.vo';

export interface BitwiseEvaluation {
  allowed: boolean;
  missingBits: string;
  evaluatedInMs: number;
}

@Injectable()
export class BitwiseEvaluatorService {
  evaluate(userBitmask: string, requiredBitmask: string): BitwiseEvaluation {
    const start = process.hrtime.bigint();
    const user = PermissionBitmask.from(userBitmask || '0');
    const allowed = user.allows(requiredBitmask || '0');
    const missing = allowed ? '0' : user.missing(requiredBitmask || '0').toString();
    const evaluatedInMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { allowed, missingBits: missing, evaluatedInMs };
  }
}
