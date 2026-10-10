// SSOT Phase 109 §6 — admin users client (fetch wrappers + window math)
// Canonical: apps/frontend/lib/admin-users.ts
// - Dep-free windowing helper (52px rows, overscan 10, DOM ≤ 60 rows).
// - Zero new deps.
import type {
  UserMerchantFilter,
  AdminUserTableItem,
  KycPendingItem,
} from '@repo/shared';

export type { UserMerchantFilter, AdminUserTableItem, KycPendingItem };

export interface AdminUsersListResponse {
  items: AdminUserTableItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summaryStats: {
    totalUsers: number;
    totalSellers: number;
    totalInstructors: number;
    pendingKYCCount: number;
    totalWalletCirculation: number;
  };
}

export const ADMIN_TABLE_ROW_PX = 52;
export const ADMIN_TABLE_OVERSCAN = 10;

/** Visible window [start, end) for a scrollTop/viewport pair. */
export function windowRange(scrollTop: number, viewportPx: number, total: number, rowPx = ADMIN_TABLE_ROW_PX, overscan = ADMIN_TABLE_OVERSCAN): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowPx) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportPx) / rowPx) + overscan);
  return { start, end };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Admin request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function buildListQuery(filter: Partial<UserMerchantFilter>): string {
  const params = new URLSearchParams();
  if (filter.tenantId) params.set('tenantId', filter.tenantId);
  if (filter.searchKeyword) params.set('searchKeyword', filter.searchKeyword);
  if (filter.role?.length) params.set('role', filter.role.join(','));
  if (filter.kycStatus?.length) params.set('kycStatus', filter.kycStatus.join(','));
  if (filter.minWalletBalance !== undefined) params.set('minWalletBalance', String(filter.minWalletBalance));
  if (filter.maxWalletBalance !== undefined) params.set('maxWalletBalance', String(filter.maxWalletBalance));
  params.set('page', String(filter.page ?? 1));
  params.set('pageSize', String(filter.pageSize ?? 20));
  params.set('sortBy', filter.sortBy ?? 'createdAt');
  params.set('sortOrder', filter.sortOrder ?? 'desc');
  return params.toString();
}

export async function fetchAdminUsers(filter: Partial<UserMerchantFilter>): Promise<AdminUsersListResponse> {
  const res = await fetch(`/api/admin/users?${buildListQuery(filter)}`, { credentials: 'include' });
  return json<AdminUsersListResponse>(res);
}

export async function fetchAdminUserDetail(userId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include' });
  return json<Record<string, unknown>>(res);
}

export async function executeAdminAction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/admin/users/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return json<Record<string, unknown>>(res);
}

export async function fetchKycPending(page = 1, pageSize = 20): Promise<{ items: KycPendingItem[]; total: number; page: number; totalPages: number }> {
  const res = await fetch(`/api/admin/users/kyc/pending?page=${page}&pageSize=${pageSize}`, { credentials: 'include' });
  return json(res);
}

export async function fetchKycDocuments(userId: string): Promise<{ userId: string; urls: Array<{ objectKey: string; url: string; expiresIn: number }> }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/kyc/documents`, { credentials: 'include' });
  return json(res);
}

export function formatTHB(n: number): string {
  return `฿${Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTHDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH');
}
