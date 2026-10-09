// SSOT Phase 097 §7.1 — B2B analytics (HR dashboard aggregates)
// Canonical: apps/backend/src/modules/b2b/services/b2b-analytics.service.ts
// - Seat utilization + per-license completion funnel for the HR dashboard.
//   Read-only (no txn). Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { remainingSeats } from '@repo/shared';
import type { B2bRepository } from '../repositories/b2b-prisma.repository';

export interface LicenseProgressPort {
  licenseCompletion(licenseId: string): Promise<{ assigned: number; activeUsers: number }>;
}

@Injectable()
export class B2bAnalyticsService {
  constructor(
    private readonly repo: B2bRepository,
    private readonly progress: LicenseProgressPort,
  ) {}

  async dashboard(corporateAccountId: string): Promise<{
    licenses: Array<{
      licenseId: string;
      productTitle: string;
      totalSeats: number;
      usedSeats: number;
      remainingSeats: number;
      status: string;
      assigned: number;
      activeUsers: number;
    }>;
  }> {
    const rows = await this.repo.findAccountLicenses(corporateAccountId);
    const licenses = await Promise.all(
      rows.map(async (row) => {
        const funnel = await this.progress.licenseCompletion(row.id).catch(() => ({ assigned: 0, activeUsers: 0 }));
        return {
          licenseId: row.id,
          productTitle: row.productTitle,
          totalSeats: row.totalSeats,
          usedSeats: row.usedSeats,
          remainingSeats: remainingSeats(row.totalSeats, row.usedSeats),
          status: row.status,
          assigned: funnel.assigned,
          activeUsers: funnel.activeUsers,
        };
      }),
    );
    return { licenses };
  }
}
