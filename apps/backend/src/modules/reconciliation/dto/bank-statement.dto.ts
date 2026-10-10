// SSOT Phase 115 §3.1 — statement transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/reconciliation/dto/bank-statement.dto.ts
// - Zero new deps.
export interface BankStatementImportDto {
  bankCode: string;
  accountNumber: string;
  transRef: string;
  amount: number;
  txType: 'CREDIT' | 'DEBIT';
  txTimestamp: string;
  senderBank?: string;
  senderName?: string;
  rawPayload: unknown;
}
