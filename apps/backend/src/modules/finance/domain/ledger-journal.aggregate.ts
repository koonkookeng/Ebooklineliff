// SSOT Phase 081 §4.1/§8.1 — Ledger journal aggregate guards
// Canonical: apps/backend/src/modules/finance/domain/ledger-journal.aggregate.ts
// - Append-only invariant (§8.3): journals/entries are created, never
//   updated/deleted — corrections post reversal journals (no UPDATE/DELETE
//   path exists in the repository by construction).
// - Balanced-equation guard (§8.1): sum(debits) == sum(credits) per journal.
// - Zero new deps.
import { InternalServerErrorException } from '@nestjs/common';
import { assertBalanced } from '@repo/shared';

export interface JournalLine {
  accountType: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
}

/** Assert a journal's lines balance before persistence (Gate 7). */
export function assertJournalBalanced(lines: JournalLine[]): void {
  const debits = lines.filter((l) => l.entryType === 'DEBIT').reduce((s, l) => s + l.amount, 0);
  const credits = lines.filter((l) => l.entryType === 'CREDIT').reduce((s, l) => s + l.amount, 0);
  if (Math.round(debits * 100) !== Math.round(credits * 100)) {
    throw new InternalServerErrorException('Double-entry balance mismatch error');
  }
}

export { assertBalanced };
