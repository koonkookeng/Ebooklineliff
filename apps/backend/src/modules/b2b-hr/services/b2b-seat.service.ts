// SSOT Phase 098 BDD-1 — HR seat allocation (CSV/LINE batch + counter sync)
// Canonical: apps/backend/src/modules/b2b-hr/services/b2b-seat.service.ts
// - Zod gate (org uuid, batch cap 500) → INVITED rows → org usedSeats bump
//   (throws 400 when the pool is full) → stream (<500ms, Gate 8).
// - Revoke: seat REVOKED + counter release, same flow.
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { B2B_HR_STREAM, HR_ALLOCATE_BATCH_MAX } from '@repo/shared';
import type { B2bHrRepository } from '../repositories/b2b-hr.repository';

export interface HrSeatBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class B2bHrSeatService {
  constructor(
    private readonly repo: B2bHrRepository,
    private readonly bus: HrSeatBus,
  ) {}

  async allocateSeats(args: {
    organizationId: string;
    departmentId?: string;
    emails?: string[];
    lineUserIds?: string[];
  }): Promise<{ invited: number; usedSeats: number; totalSeats: number }> {
    if (!UUID_RE.test(args.organizationId)) throw new BadRequestException('Invalid organizationId');
    const emails = (args.emails ?? []).filter((e) => /.+@.+\..+/.test(e));
    const lineUserIds = (args.lineUserIds ?? []).filter((l) => l.length > 0);
    const batch = emails.length + lineUserIds.length;
    if (batch === 0) throw new BadRequestException('No valid invitees');
    if (batch > HR_ALLOCATE_BATCH_MAX) throw new BadRequestException('Batch exceeds 500 seats');
    const org = await this.repo.findOrganization(args.organizationId);
    if (!org) throw new NotFoundException('Organization not found');
    // Capacity pre-check BEFORE creating rows (no orphan invites on 400).
    if (org.usedSeats + batch > org.totalSeats) {
      throw new BadRequestException('No available seats in organization pool');
    }

    const t0 = Date.now();
    const { invited } = await this.repo.allocateSeats({
      organizationId: args.organizationId,
      departmentId: args.departmentId,
      emails,
      lineUserIds,
    });
    let usedSeats = org.usedSeats;
    let totalSeats = org.totalSeats;
    try {
      const usage = await this.repo.bumpOrgUsage(args.organizationId, invited);
      usedSeats = usage.usedSeats;
      totalSeats = usage.totalSeats;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    await this.bus
      .xadd(B2B_HR_STREAM, {
        event: 'hr_seats_allocated',
        organizationId: args.organizationId,
        invited,
        usedSeats,
        totalSeats,
        tookMs: Date.now() - t0,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { invited, usedSeats, totalSeats };
  }

  async revokeSeat(seatId: string): Promise<{ released: boolean; usedSeats: number }> {
    const seat = await this.repo.findSeat(seatId);
    if (!seat) throw new NotFoundException('Seat not found');
    if (seat.status === 'REVOKED') throw new BadRequestException('Seat already revoked');
    await this.repo.revokeSeat(seatId);
    const usage = await this.repo.bumpOrgUsage(seat.organizationId, -1).catch(() => null);
    await this.bus
      .xadd(B2B_HR_STREAM, { event: 'hr_seat_revoked', seatId, at: Date.now() })
      .catch(() => undefined);
    return { released: true, usedSeats: usage?.usedSeats ?? 0 };
  }
}
