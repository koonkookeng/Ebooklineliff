// SSOT Phase 098 §7.1 — HR analytics aggregator (Redis read-through, <500ms)
// Canonical: apps/backend/src/modules/b2b-hr/services/b2b-analytics.service.ts
// - dashboard(orgId): edge cache (60s) → seats + quiz attempts → per-seat
//   completion/avg-score → department matrix + pass/fail ratio (BDD-2).
// - Read-only (no txn). Port-based for DB-free tests. Zero new deps.
import { Injectable, NotFoundException } from '@nestjs/common';
import { HR_DASHBOARD_CACHE_TTL_SEC, averageScore, hrDashboardCacheKey, seatUtilization } from '@repo/shared';
import type { B2bHrRepository, HrQuizAttemptRow, HrSeatRow } from '../repositories/b2b-hr.repository';

export interface HrDashboardCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface HrDashboardResult {
  organizationId: string;
  companyName: string;
  totalSeats: number;
  usedSeats: number;
  utilization: number;
  completionRate: number;
  averageScore: number;
  passed: number;
  failed: number;
  departments: Array<{
    departmentId: string | null;
    departmentName: string;
    seats: number;
    active: number;
    averageScore: number;
  }>;
  employees: Array<{
    seatId: string;
    employeeName: string;
    department: string;
    status: string;
    attempts: number;
    averageScore: number;
    lastActive: string | null;
  }>;
}

@Injectable()
export class B2bHrAnalyticsService {
  constructor(
    private readonly repo: B2bHrRepository,
    private readonly cache: HrDashboardCache,
  ) {}

  async dashboard(organizationId: string): Promise<HrDashboardResult> {
    const key = hrDashboardCacheKey(organizationId);
    const hit = await this.cache.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as HrDashboardResult;

    const org = await this.repo.findOrganization(organizationId);
    if (!org) throw new NotFoundException('Organization not found');
    const seats = await this.repo.listSeats(organizationId);
    const attempts = await this.repo.listQuizAttempts(seats.map((s) => s.id));

    const result = this.aggregate(org.companyName, organizationId, org.totalSeats, org.usedSeats, seats, attempts);
    await this.cache.set(key, JSON.stringify(result), HR_DASHBOARD_CACHE_TTL_SEC).catch(() => undefined);
    return result;
  }

  aggregate(
    companyName: string,
    organizationId: string,
    totalSeats: number,
    usedSeats: number,
    seats: HrSeatRow[],
    attempts: HrQuizAttemptRow[],
  ): HrDashboardResult {
    const bySeat = new Map<string, HrQuizAttemptRow[]>();
    for (const a of attempts) {
      const list = bySeat.get(a.seatId) ?? [];
      list.push(a);
      bySeat.set(a.seatId, list);
    }
    const seatAvg = (seatId: string): number => {
      const rows = bySeat.get(seatId) ?? [];
      if (rows.length === 0) return 0;
      return averageScore(rows.map((r) => (r.maxScore > 0 ? (r.scoreObtained / r.maxScore) * 100 : 0)));
    };

    const employees = seats.map((s) => {
      const rows = bySeat.get(s.id) ?? [];
      return {
        seatId: s.id,
        employeeName: s.employeeName ?? s.employeeEmail,
        department: s.departmentName ?? '—',
        status: s.status,
        attempts: rows.length,
        averageScore: Math.round(seatAvg(s.id) * 100) / 100,
        lastActive: rows.length > 0 ? new Date(Math.max(...rows.map((r) => new Date(r.completedAt).getTime()))).toISOString() : null,
      };
    });

    const deptMap = new Map<string, { departmentId: string | null; departmentName: string; seats: number; active: number; scores: number[] }>();
    for (const s of seats) {
      const k = s.departmentId ?? '__none__';
      const d = deptMap.get(k) ?? {
        departmentId: s.departmentId,
        departmentName: s.departmentName ?? '—',
        seats: 0,
        active: 0,
        scores: [],
      };
      d.seats += 1;
      if (s.status === 'ACTIVE') d.active += 1;
      d.scores.push(seatAvg(s.id));
      deptMap.set(k, d);
    }
    const departments = [...deptMap.values()].map((d) => ({
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      seats: d.seats,
      active: d.active,
      averageScore: Math.round(averageScore(d.scores) * 100) / 100,
    }));

    const attempted = employees.filter((e) => e.attempts > 0).length;
    const passed = attempts.filter((a) => a.isPassed).length;
    const failed = attempts.length - passed;
    return {
      organizationId,
      companyName,
      totalSeats,
      usedSeats,
      utilization: seatUtilization(usedSeats, totalSeats),
      completionRate: seats.length === 0 ? 0 : Math.round((attempted / seats.length) * 10000) / 100,
      averageScore: Math.round(averageScore(employees.map((e) => e.averageScore)) * 100) / 100,
      passed,
      failed,
      departments,
      employees,
    };
  }
}
