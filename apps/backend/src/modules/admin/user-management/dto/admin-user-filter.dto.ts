// SSOT Phase 109 §3.1 — Admin filter/action DTOs (REST coercion layer)
// Canonical: apps/backend/src/modules/admin/user-management/dto/admin-user-filter.dto.ts
// - Zod SSOT lives in @repo/shared (admin-user.schema.ts); this file only adds
//   the REST query-string coercion (comma lists, numeric strings) and re-exports
//   the canonical schemas (Zero Redundant Code).
// - Zero new deps.
import { z } from 'zod';
import {
  UserMerchantFilterSchema,
  AdminUserSortByEnum,
  type UserMerchantFilter,
} from '@repo/shared';

export { UserMerchantFilterSchema, AdminUserSortByEnum };
export type { UserMerchantFilter };

const csvToList = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

/** GET /api/v1/admin/users query (?role=SELLER,INSTRUCTOR&page=2). */
export const AdminUserFilterQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  searchKeyword: z.string().max(120).optional(),
  role: z.preprocess(csvToList, z.array(z.string()).optional()),
  kycStatus: z.preprocess(csvToList, z.array(z.string()).optional()),
  minWalletBalance: z.coerce.number().nonnegative().optional(),
  maxWalletBalance: z.coerce.number().nonnegative().optional(),
  hasAffiliateReferrals: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: AdminUserSortByEnum.default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type AdminUserFilterQuery = z.infer<typeof AdminUserFilterQuerySchema>;
