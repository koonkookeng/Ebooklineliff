// SSOT Phase 013 §3.1 — PromptPay DTOs (thin: Zod SSOT is the single source)
// Canonical: apps/backend/src/modules/payment/dto/promptpay-qr.dto.ts
// (legacy src/backend/modules/payment/dto/promptpay-qr.dto.ts)
// Zero-redundant policy: no duplicated shapes — infer from @repo/shared.
import type {
  CreatePromptPayQRInput,
  PromptPayQRPayload,
  PromptPayExpiryStatus,
  PromptPayStatus,
} from '@repo/shared';

export type { CreatePromptPayQRInput, PromptPayQRPayload, PromptPayExpiryStatus, PromptPayStatus };
export type GenerateQrBody = CreatePromptPayQRInput;
export type QrStatusResponse = PromptPayExpiryStatus;
