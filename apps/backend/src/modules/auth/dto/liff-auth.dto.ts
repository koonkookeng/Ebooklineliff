// SSOT Phase 006 §5.1 — LIFF auth DTO (Zod is the validator; this file is the Nest-typed surface)
// Canonical: apps/backend/src/modules/auth/dto/liff-auth.dto.ts
// (legacy src/backend/modules/auth/dto/liff-auth.dto.ts)
import { LiffAuthInputSchema, type LiffAuthInput, type DeviceInfo } from '@repo/shared';

export type LiffAuthDto = LiffAuthInput;
export type { DeviceInfo };

export function parseLiffAuthDto(raw: unknown): LiffAuthDto {
  const parsed = LiffAuthInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid LIFF auth payload: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
