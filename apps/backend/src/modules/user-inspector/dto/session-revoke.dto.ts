// SSOT Phase 110 §5.1 — Session revoke / risk-flag DTOs
// Canonical: apps/backend/src/modules/user-inspector/dto/session-revoke.dto.ts
// - Body schemas for revoke + RFM recalculation + risk flagging.
// - Zero new deps.
import { z } from 'zod';
import { RiskLevelEnum } from '@repo/shared';

export { RiskLevelEnum };

export const SessionRevokeBodySchema = z.object({
  reason: z.string().min(5, 'กรุณาระบุเหตุผลในการยกเลิก session อย่างน้อย 5 ตัวอักษร').max(500),
});
export type SessionRevokeBody = z.infer<typeof SessionRevokeBodySchema>;

export const RiskFlagBodySchema = z.object({
  riskLevel: RiskLevelEnum,
  note: z.string().min(5, 'กรุณาระบุหมายเหตุประกอบการ flag อย่างน้อย 5 ตัวอักษร').max(500),
});
export type RiskFlagBody = z.infer<typeof RiskFlagBodySchema>;
