// SSOT Phase 109 §3.1 — Admin action DTOs (REST body layer)
// Canonical: apps/backend/src/modules/admin/user-management/dto/admin-user-action.dto.ts
// - Canonical schemas (payload/table-item/KYC) live in @repo/shared;
//   re-exported here so REST + GQL share one source (Zero Redundant Code).
// - Zero new deps.
import { z } from 'zod';
import {
  AdminUserActionPayloadSchema,
  AdminUserTableItemSchema,
  KycPendingItemSchema,
  AdminUserActionEnum,
  type AdminUserActionPayload,
  type AdminUserTableItem,
  type KycPendingItem,
} from '@repo/shared';

export { AdminUserActionPayloadSchema, AdminUserTableItemSchema, KycPendingItemSchema, AdminUserActionEnum };
export type { AdminUserActionPayload, AdminUserTableItem, KycPendingItem };

export const KycRejectBodySchema = z.object({
  reason: z.string().min(5, 'กรุณาระบุเหตุผลในการปฏิเสธอย่างน้อย 5 ตัวอักษร').max(500),
});
export type KycRejectBody = z.infer<typeof KycRejectBodySchema>;

export const ImpersonateBodySchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(5, 'กรุณาระบุเหตุผลในการดำเนินการอย่างน้อย 5 ตัวอักษร').max(500),
});
export type ImpersonateBody = z.infer<typeof ImpersonateBodySchema>;

export const WalletAdjustBodySchema = z.object({
  amount: z.number().finite(),
  reason: z.string().min(5, 'กรุณาระบุเหตุผลในการดำเนินการอย่างน้อย 5 ตัวอักษร').max(500),
});
export type WalletAdjustBody = z.infer<typeof WalletAdjustBodySchema>;
