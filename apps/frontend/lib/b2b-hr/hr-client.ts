// SSOT Phase 098 — HR dashboard client (REST transport)
// Canonical: apps/frontend/lib/b2b-hr/hr-client.ts
// - Zero-dep (fetch only).
export type HrStatus = 'HR_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface HrDepartmentStat {
  departmentId: string | null;
  departmentName: string;
  seats: number;
  active: number;
  averageScore: number;
}

export interface HrEmployeeRow {
  seatId: string;
  employeeName: string;
  department: string;
  status: string;
  attempts: number;
  averageScore: number;
  lastActive: string | null;
}

export interface HrDashboard {
  organizationId: string;
  companyName: string;
  totalSeats: number;
  usedSeats: number;
  utilization: number;
  completionRate: number;
  averageScore: number;
  passed: number;
  failed: number;
  departments: HrDepartmentStat[];
  employees: HrEmployeeRow[];
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`hr ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function hrApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    dashboard: (orgId: string) =>
      json<HrDashboard>(`/api/v1/b2b-hr/analytics?orgId=${encodeURIComponent(orgId)}`),
    allocate: (body: { organizationId: string; departmentId?: string; emails?: string[]; lineUserIds?: string[] }) =>
      post('/api/v1/b2b-hr/allocate', body) as Promise<{ invited: number; usedSeats: number; totalSeats: number }>,
    exportUrl: (orgId: string) => `/api/v1/b2b-hr/export-pdf?orgId=${encodeURIComponent(orgId)}`,
  };
}
