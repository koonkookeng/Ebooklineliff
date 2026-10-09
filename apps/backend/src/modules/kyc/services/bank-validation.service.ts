// SSOT Phase 085 Task 4 — Bank name fuzzy validation (Levenshtein §7)
// Canonical: apps/backend/src/modules/kyc/services/bank-validation.service.ts
// - calculateFuzzyMatchScore: title-stripped, normalized similarity.
// - Tier mapping per §7 (AUTO ≥0.90 / REVIEW 0.75–0.89 / REJECT <0.75).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { fuzzyNameScore, kycScoreTier } from '@repo/shared';

@Injectable()
export class BankValidationService {
  calculateFuzzyMatchScore(idCardName: string, bankAccountName: string): number {
    return fuzzyNameScore(idCardName, bankAccountName);
  }

  tierFor(score: number): 'AUTO' | 'REVIEW' | 'REJECT' {
    return kycScoreTier(score);
  }
}
