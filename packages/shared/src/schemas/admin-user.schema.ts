// SSOT Phase 109 §3.1 — Universal User & Merchant Management Table contract
// Canonical: packages/shared/src/schemas/admin-user.schema.ts
// - Spec-verbatim: UserRoleEnum / KYCStatusEnum / UserMerchantFilterSchema /
//   AdminUserActionPayloadSchema / AdminUserTableItemSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - KYCStatusEnum carries ACTION_REQUIRED (Phase 085 canonical union): the
//     spec's 4 values validate unchanged; the 5th only ever appears on rows
//     that went through manual review. Same union precedent as 073/076
//     FulfillmentStatus.
//   - userId accepts min(1) edge vocabulary in addition to uuid (Phase
//     023-031 precedent: seeded/test ids are not always uuid).
//   - @tanstack/react-table + @tanstack/react-virtual are NOT installed
//     (zero-new-deps): the console renders a dep-free windowed table with the
//     same 52px/overscan-10/DOM<300 contract (see ADMIN_TABLE_* constants).
//   - Impersonation is an HMAC ticket (no @nestjs/jwt installed): pattern
//     copied from abandoned-cart signRecoveryToken (node:crypto via require).
// - Zero new deps (zod only).
import { z } from 'zod';

export const UserRoleEnum = z.enum([
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
  'INSTRUCTOR',
  'SELLER',
  'MEMBER',
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

export const KYCStatusEnum = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'ACTION_REQUIRED',
]);
export type KYCStatus = z.infer<typeof KYCStatusEnum>;

export const AdminUserSortByEnum = z.enum(['createdAt', 'displayName', 'walletBalance', 'rewardPoints']);
export type AdminUserSortBy = z.infer<typeof AdminUserSortByEnum>;

export const AdminUserActionEnum = z.enum([
  'UPDATE_ROLE',
  'FREEZE_ACCOUNT',
  'UNFREEZE_ACCOUNT',
  'ADJUST_WALLET',
  'APPROVE_KYC',
  'REJECT_KYC',
  'GENERATE_IMPERSONATION_TOKEN',
]);
export type AdminUserAction = z.infer<typeof AdminUserActionEnum>;

export const UserMerchantFilterSchema = z.object({
  tenantId: z.string().min(1).optional(),
  searchKeyword: z.string().max(120).optional(),
  role: z.array(UserRoleEnum).max(7).optional(),
  kycStatus: z.array(KYCStatusEnum).max(5).optional(),
  minWalletBalance: z.number().nonnegative().optional(),
  maxWalletBalance: z.number().nonnegative().optional(),
  hasAffiliateReferrals: z.boolean().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: AdminUserSortByEnum.default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type UserMerchantFilter = z.infer<typeof UserMerchantFilterSchema>;

export const AdminUserActionPayloadSchema = z.object({
  userId: z.string().min(1),
  action: AdminUserActionEnum,
  newRole: UserRoleEnum.optional(),
  walletAdjustmentAmount: z.number().finite().optional(),
  reason: z.string().min(5, 'กรุณาระบุเหตุผลในการดำเนินการอย่างน้อย 5 ตัวอักษร').max(500),
  rejectionReason: z.string().max(500).optional(),
});
export type AdminUserActionPayload = z.infer<typeof AdminUserActionPayloadSchema>;

export const AdminUserTableItemSchema = z.object({
  id: z.string(),
  lineUserId: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  role: UserRoleEnum,
  kycStatus: KYCStatusEnum,
  walletBalance: z.number(),
  rewardPoints: z.number(),
  affiliateCode: z.string(),
  totalOrdersCount: z.number().int(),
  totalSpentAmount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminUserTableItem = z.infer<typeof AdminUserTableItemSchema>;

export const KycPendingItemSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  kycStatus: KYCStatusEnum,
  idCardImageUrl: z.string().nullable(),
  bankName: z.string().nullable(),
  bankAccountName: z.string().nullable(),
  submittedAt: z.string().datetime(),
});
export type KycPendingItem = z.infer<typeof KycPendingItemSchema>;

/** Roles allowed into the central admin console (BDD: SUPER/FINANCE first). */
export const ADMIN_CONSOLE_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_STAFF'] as const;

/** 5-state UI machine (§2.2). */
export const AdminUserUiStateEnum = z.enum(['ADMIN_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']);
export type AdminUserUiState = z.infer<typeof AdminUserUiStateEnum>;

/** Budgets & cache keys (§7.1, §8.1, §10.1). */
export const ADMIN_STATS_TTL_SEC = 60;
export const ADMIN_LIST_CACHE_TTL_SEC = 30;
export const IMPERSONATION_TTL_SEC = 900; // 15 mins (BDD Scenario 2)
export const KYC_PRESIGN_TTL_SEC = 120; // 2-minute KYC doc URLs (§8.1)
export const ADMIN_TABLE_ROW_PX = 52;
export const ADMIN_TABLE_OVERSCAN = 10;
export const ADMIN_TABLE_MAX_DOM_ROWS = 60; // << 300 DOM-node budget (§1.3)
export const ADMIN_TABLE_MAX_PAGE_SIZE = 100;

export function adminUsersCacheKey(filter: Record<string, unknown>): string {
  const parts = ['role', 'kycStatus', 'searchKeyword', 'tenantId', 'minWalletBalance', 'maxWalletBalance', 'hasAffiliateReferrals', 'createdFrom', 'createdTo', 'page', 'pageSize', 'sortBy', 'sortOrder']
    .map((k) => `${k}=${JSON.stringify(filter[k] ?? null)}`)
    .join('&');
  return `admin:users:${parts}`;
}

export function adminStatsKey(tenantId?: string): string {
  return `admin:stats:${tenantId ?? 'global'}`;
}

export function impersonationTicketKey(adminId: string, targetUserId: string, nonce: string): string {
  return `admin:impersonate:${adminId}:${targetUserId}:${nonce}`;
}

// ---------- HMAC impersonation tickets (no @nestjs/jwt; abandoned-cart pattern) ----------
interface NodeCryptoShim {
  createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

function nodeCrypto(): NodeCryptoShim {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** Mint a 15-min scoped impersonation ticket: base64url(`${v}:${target}:${admin}:${exp}:${nonce}:${hmac}`). */
export function signImpersonationTicket(secret: string, targetUserId: string, adminId: string, nonce: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + IMPERSONATION_TTL_SEC;
  const body = `v1:${targetUserId}:${adminId}:${exp}:${nonce}`;
  const hmac = nodeCrypto().createHmac('sha256', secret).update(body).digest('hex');
  return b64urlEncode(`${body}:${hmac}`);
}

/** Verify ticket; returns {targetUserId, adminId} or null (expired/forged). */
export function verifyImpersonationTicket(secret: string, ticket: string, now = Date.now()): { targetUserId: string; adminId: string } | null {
  try {
    const raw = b64urlDecode(ticket);
    const [v, targetUserId, adminId, expRaw, nonce, hmac] = raw.split(':');
    if (v !== 'v1' || !targetUserId || !adminId || !expRaw || !nonce || !hmac) return null;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || Math.floor(now / 1000) > exp) return null;
    const crypto = nodeCrypto();
    const expected = crypto.createHmac('sha256', secret).update(`v1:${targetUserId}:${adminId}:${expRaw}:${nonce}`).digest('hex');
    const a = Buffer.from(hmac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { targetUserId, adminId };
  } catch {
    return null;
  }
}
