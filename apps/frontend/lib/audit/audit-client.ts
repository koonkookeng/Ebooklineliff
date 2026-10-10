// SSOT Phase 118 §2 — audit console client (REST transport)
// Canonical: apps/frontend/lib/audit/audit-client.ts
// - Paginated reads + chain verify + append. Hash details render only for
//   auditor roles (server gates; client mirrors the Gate 4 rule).
// - Zero-dep (fetch only).
export type AuditUiState = 'INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface AuditLogView {
  id: string;
  sequenceNumber: number;
  actorId: string;
  actorRole: string;
  actorEmail: string;
  actionCategory: string;
  actionName: string;
  targetEntity: string;
  targetEntityId: string | null;
  previousHash: string;
  currentHash: string;
  integrityStatus: string;
  createdAt: string;
}

export interface AuditVerifyView {
  valid: boolean;
  checked: number;
  tamperedBlockSequences: number[];
}

const AUDITOR_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN'];

/** Client mirror of the Gate 4 hash-visibility rule (server enforces). */
export function canSeeHashDetails(role: string | undefined): boolean {
  return !!role && AUDITOR_ROLES.includes(role);
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`audit ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function auditApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    logs: (params?: { actorId?: string; actionCategory?: string; integrityStatus?: string; page?: number; limit?: number }) => {
      const q = new URLSearchParams({ tenant: slug });
      if (params?.actorId) q.set('actorId', params.actorId);
      if (params?.actionCategory) q.set('actionCategory', params.actionCategory);
      if (params?.integrityStatus) q.set('integrityStatus', params.integrityStatus);
      q.set('page', String(params?.page ?? 1));
      q.set('limit', String(params?.limit ?? 20));
      return json<AuditLogView[]>(`/api/v1/admin/audit/logs?${q.toString()}`);
    },
    verify: (take = 1000) => json<AuditVerifyView>(`/api/v1/admin/audit/verify?${qs}&take=${take}`),
    append: (body: { actionCategory: string; actionName: string; targetEntity: string; targetEntityId?: string }) =>
      post(`/api/v1/admin/audit/append?${qs}`, body) as Promise<{ id: string; sequenceNumber: number | bigint; currentHash: string }>,
  };
}
