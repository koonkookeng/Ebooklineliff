// SSOT Phase 097 BDD-2/3 — Atomic seat allocation (locked claim + revoke)
// Canonical: apps/backend/src/modules/b2b/services/b2b-seat-allocation.service.ts
// - Claim: Redis pool mutex (409 on race) → ACTIVE+expiry guard →
//   idempotent re-claim → ONE $transaction: seat row + usage bump (+
//   EXHAUSTED flip) + 012 CORPORATE_LICENSE grant + expiry stamp (Gate 7)
//   → edge cache + stream (<800ms, Gate 8).
// - Revoke: seat REVOKED + entitlement delete + pool release, same txn.
// - Entitlement writes reuse EntitlementGrantService (012 single writer).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { B2B_STREAM, corporateClaimLockKey, licenseStatusAfter, remainingSeats } from '@repo/shared';
import type { B2bRepository } from '../repositories/b2b-prisma.repository';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';

export interface ClaimTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface ClaimLockPort {
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  setEdge(key: string, value: string, ttlSec: number): Promise<void>;
  delEdge(key: string): Promise<void>;
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

@Injectable()
export class B2bSeatAllocationService {
  constructor(
    private readonly repo: B2bRepository,
    private readonly locks: ClaimLockPort,
    private readonly tx: ClaimTx,
    private readonly grants: EntitlementGrantService,
  ) {}

  async claimSeatForUser(args: { licenseCode: string; userId: string; lineUserId?: string }): Promise<{
    success: boolean;
    message: string;
    licenseId: string;
    assignedSeatId: string;
    entitlementGranted: boolean;
    remainingSeats: number;
  }> {
    if (!args.licenseCode) throw new BadRequestException('Missing licenseCode');
    let locked = false;
    try {
      locked = (await this.locks.set(corporateClaimLockKey(args.licenseCode), args.userId, 'NX', 'EX', 10).catch(() => null)) === 'OK';
    } catch {
      locked = false;
    }
    if (!locked) throw new ConflictException('System is busy processing requests. Please retry.');

    const t0 = Date.now();
    try {
      const license = await this.repo.findLicenseByCode(args.licenseCode);
      if (!license || license.status !== 'ACTIVE') {
        return { success: false, message: 'ลิงก์สิทธิ์หมดอายุหรือไม่ถูกต้อง', licenseId: '', assignedSeatId: '', entitlementGranted: false, remainingSeats: 0 };
      }
      if (license.expiresAt && new Date(license.expiresAt).getTime() < t0) {
        return { success: false, message: 'ลิงก์สิทธิ์หมดอายุหรือไม่ถูกต้อง', licenseId: '', assignedSeatId: '', entitlementGranted: false, remainingSeats: 0 };
      }
      const existing = await this.repo.findActiveSeat(license.id, args.userId);
      if (existing) {
        return {
          success: true,
          message: 'You have already claimed a seat in this license.',
          licenseId: license.id,
          assignedSeatId: existing.id,
          entitlementGranted: true,
          remainingSeats: remainingSeats(license.totalSeats, license.usedSeats),
        };
      }
      if (license.usedSeats >= license.totalSeats) {
        return { success: false, message: 'สิทธิ์เต็มแล้ว กรุณาติดต่อ HR ของท่าน', licenseId: license.id, assignedSeatId: '', entitlementGranted: false, remainingSeats: 0 };
      }

      const usedAfter = license.usedSeats + 1;
      const statusAfter = licenseStatusAfter(license.totalSeats, usedAfter);
      let seatId = '';
      await this.tx.run(async (tx) => {
        const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
        const seat = await repo.claimSeat(tx, { licenseId: license.id, userId: args.userId, lineUserId: args.lineUserId });
        seatId = seat.seatId;
        await repo.bumpUsage(tx, license.id, usedAfter, statusAfter);
        await this.grants.grantForOrder(tx as never, args.userId, [license.productId], 'CORPORATE_LICENSE');
        await repo.setEntitlementExpiry(tx, args.userId, license.productId, license.expiresAt);
      });

      await this.locks.setEdge(`entitlement:${args.userId}:${license.productId}`, 'GRANTED', 86400).catch(() => undefined);
      await this.locks
        .xaddPipeline(B2B_STREAM, [
          {
            event: 'corporate_seat_claimed',
            licenseId: license.id,
            seatId,
            userId: args.userId,
            tookMs: Date.now() - t0,
            at: Date.now(),
          },
        ])
        .catch(() => undefined);
      return {
        success: true,
        message: 'Corporate seat successfully claimed!',
        licenseId: license.id,
        assignedSeatId: seatId,
        entitlementGranted: true,
        remainingSeats: remainingSeats(license.totalSeats, usedAfter),
      };
    } finally {
      await this.locks.del(corporateClaimLockKey(args.licenseCode)).catch(() => undefined);
    }
  }

  async revokeSeat(args: { seatId: string }): Promise<boolean> {
    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      const seat = await repo.revokeSeat(tx, args.seatId);
      await repo.releaseUsage(tx, seat.licenseId);
      if (seat.userId) {
        const lic = await repo.findLicenseById(seat.licenseId);
        if (lic) {
          await repo.revokeEntitlement(tx, seat.userId, lic.productId);
          await this.locks.delEdge(`entitlement:${seat.userId}:${lic.productId}`).catch(() => undefined);
        }
      }
    });
    await this.locks
      .xaddPipeline(B2B_STREAM, [{ event: 'corporate_seat_revoked', seatId: args.seatId, at: Date.now() }])
      .catch(() => undefined);
    return true;
  }
}
