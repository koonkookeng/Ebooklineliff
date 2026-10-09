// SSOT Phase 097 §5.1 — B2B repository port + Prisma adapter (single seam)
// Canonical: apps/backend/src/modules/b2b/repositories/b2b-prisma.repository.ts
// - RISK_CALL: port + adapter co-located (spec tree has no domain/ layer —
//   single-file seam keeps the tree canonical). Seat/entitlement mutations
//   run inside caller-owned $transactions (Gate 7).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface CorporateLicenseRow {
  id: string;
  corporateAccountId: string;
  companyName: string;
  productId: string;
  productTitle: string;
  totalSeats: number;
  usedSeats: number;
  licenseCode: string;
  status: string;
  expiresAt: Date | null;
}

export interface B2bRepository {
  createAccount(args: { companyName: string; taxId: string; contactEmail: string }): Promise<{ id: string }>;
  createLicense(args: {
    corporateAccountId: string;
    productId: string;
    totalSeats: number;
    licenseCode: string;
    expiresAt: Date | null;
  }): Promise<{ id: string; licenseCode: string }>;
  findLicenseByCode(licenseCode: string): Promise<CorporateLicenseRow | null>;
  findLicenseById(licenseId: string): Promise<CorporateLicenseRow | null>;
  findAccountLicenses(corporateAccountId: string): Promise<CorporateLicenseRow[]>;
  claimSeat(tx: unknown, args: { licenseId: string; userId: string; lineUserId?: string }): Promise<{ seatId: string }>;
  bumpUsage(tx: unknown, licenseId: string, usedSeats: number, status: string): Promise<{ totalSeats: number; usedSeats: number }>;
  findActiveSeat(licenseId: string, userId: string): Promise<{ id: string } | null>;
  revokeSeat(tx: unknown, seatId: string): Promise<{ licenseId: string; userId: string | null }>;
  releaseUsage(tx: unknown, licenseId: string): Promise<void>;
  setEntitlementExpiry(tx: unknown, userId: string, productId: string, expiresAt: Date | null): Promise<void>;
  revokeEntitlement(tx: unknown, userId: string, productId: string): Promise<void>;
  allocateInvites(args: { licenseId: string; departmentId?: string; emails: string[]; lineUserIds: string[] }): Promise<number>;
  withTx?(tx: unknown): B2bRepository;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

interface LicenseWithJoins {
  id: string;
  corporateAccountId: string;
  corporateAccount: { companyName: string };
  productId: string;
  product: { title: string };
  totalSeats: number;
  usedSeats: number;
  licenseCode: string;
  status: string;
  expiresAt: Date | null;
}

function mapLicense(row: LicenseWithJoins): CorporateLicenseRow {
  return {
    id: row.id,
    corporateAccountId: row.corporateAccountId,
    companyName: row.corporateAccount.companyName,
    productId: row.productId,
    productTitle: row.product.title,
    totalSeats: row.totalSeats,
    usedSeats: row.usedSeats,
    licenseCode: row.licenseCode,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}

function toRepo(db: Db): B2bRepository {
  const accounts = db['corporateAccount'];
  const licenses = db['corporateLicense'];
  const seats = db['corporateSeat'];
  const entitlements = db['entitlement'];
  return {
    async createAccount(args) {
      const row = (await accounts.upsert({
        where: { taxId: (args as { taxId: string }).taxId },
        update: { companyName: (args as { companyName: string }).companyName, contactEmail: (args as { contactEmail: string }).contactEmail },
        create: { ...(args as object) },
      })) as unknown as { id: string };
      return { id: row.id };
    },

    async createLicense(args) {
      const row = (await licenses.create({ data: { ...args, usedSeats: 0, status: 'ACTIVE' } })) as unknown as {
        id: string; licenseCode: string;
      };
      return { id: row.id, licenseCode: row.licenseCode };
    },

    async findLicenseByCode(licenseCode: string): Promise<CorporateLicenseRow | null> {
      const row = (await licenses
        .findUnique({
          where: { licenseCode },
          include: { corporateAccount: true, product: true },
        })
        .catch(() => null)) as unknown as LicenseWithJoins | null;
      return row ? mapLicense(row) : null;
    },

    async findLicenseById(licenseId: string): Promise<CorporateLicenseRow | null> {
      const row = (await licenses
        .findUnique({
          where: { id: licenseId },
          include: { corporateAccount: true, product: true },
        })
        .catch(() => null)) as unknown as LicenseWithJoins | null;
      return row ? mapLicense(row) : null;
    },

    async findAccountLicenses(corporateAccountId: string): Promise<CorporateLicenseRow[]> {
      const rows = (await licenses
        .findMany({ where: { corporateAccountId }, include: { corporateAccount: true, product: true } })
        .catch(() => [])) as unknown as LicenseWithJoins[];
      return (rows as LicenseWithJoins[]).map(mapLicense);
    },

    async claimSeat(tx: unknown, args: { licenseId: string; userId: string; lineUserId?: string }) {
      const dbTx = (tx as Db)['corporateSeat'];
      const row = (await dbTx.create({
        data: { licenseId: args.licenseId, assignedUserId: args.userId, inviteLineUserId: args.lineUserId, status: 'ACTIVE', assignedAt: new Date() },
      })) as unknown as { id: string };
      return { seatId: row.id };
    },

    async bumpUsage(tx: unknown, licenseId: string, usedSeats: number, status: string) {
      const dbTx = (tx as Db)['corporateLicense'];
      const row = (await dbTx.update({
        where: { id: licenseId },
        data: { usedSeats, status },
      })) as unknown as { totalSeats: number; usedSeats: number };
      return { totalSeats: row.totalSeats, usedSeats: row.usedSeats };
    },

    async findActiveSeat(licenseId: string, userId: string) {
      const row = (await seats
        .findFirst({ where: { licenseId, assignedUserId: userId, status: 'ACTIVE' } })
        .catch(() => null)) as unknown as { id: string } | null;
      return row ? { id: row.id } : null;
    },

    async revokeSeat(tx: unknown, seatId: string) {
      const dbTx = (tx as Db)['corporateSeat'];
      const row = (await dbTx.update({
        where: { id: seatId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      })) as unknown as { licenseId: string; assignedUserId: string | null };
      return { licenseId: row.licenseId, userId: row.assignedUserId };
    },

    async releaseUsage(tx: unknown, licenseId: string): Promise<void> {
      const dbTx = (tx as Db)['corporateLicense'];
      // Read-then-write in the caller-owned txn: only EXHAUSTED pools flip
      // back to ACTIVE (never resurrect EXPIRED/SUSPENDED), floor at 0.
      const current = (await dbTx.findUnique({ where: { id: licenseId } })) as unknown as {
        usedSeats: number;
        status: string;
      } | null;
      await dbTx.update({
        where: { id: licenseId },
        data: {
          usedSeats: current && current.usedSeats > 0 ? { decrement: 1 } : 0,
          ...(current && current.status === 'EXHAUSTED' ? { status: 'ACTIVE' } : {}),
        },
      });
    },

    async setEntitlementExpiry(tx: unknown, userId: string, productId: string, expiresAt: Date | null): Promise<void> {
      const dbTx = (tx as Db)['entitlement'];
      await dbTx.updateMany({ where: { userId, productId }, data: { expiresAt } });
    },

    async revokeEntitlement(tx: unknown, userId: string, productId: string): Promise<void> {
      const dbTx = (tx as Db)['entitlement'];
      await dbTx.deleteMany({ where: { userId, productId, accessType: 'CORPORATE_LICENSE' } });
    },

    async allocateInvites(args: { licenseId: string; departmentId?: string; emails: string[]; lineUserIds: string[] }): Promise<number> {
      let n = 0;
      for (const email of args.emails) {
        await seats.create({
          data: { licenseId: args.licenseId, departmentId: args.departmentId, inviteEmail: email, status: 'INVITED' },
        });
        n++;
      }
      for (const lineUserId of args.lineUserIds) {
        await seats.create({
          data: { licenseId: args.licenseId, departmentId: args.departmentId, inviteLineUserId: lineUserId, status: 'INVITED' },
        });
        n++;
      }
      return n;
    },
  };
}

@Injectable()
export class PrismaB2bRepository implements B2bRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): B2bRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): B2bRepository {
    return toRepo(tx as Db);
  }

  createAccount(args: { companyName: string; taxId: string; contactEmail: string }) { return this.root.createAccount(args); }
  createLicense(args: { corporateAccountId: string; productId: string; totalSeats: number; licenseCode: string; expiresAt: Date | null }) {
    return this.root.createLicense(args);
  }
  findLicenseByCode(licenseCode: string) { return this.root.findLicenseByCode(licenseCode); }
  findLicenseById(licenseId: string) { return this.root.findLicenseById(licenseId); }
  findAccountLicenses(corporateAccountId: string) { return this.root.findAccountLicenses(corporateAccountId); }
  claimSeat(tx: unknown, args: { licenseId: string; userId: string; lineUserId?: string }) { return this.root.claimSeat(tx, args); }
  bumpUsage(tx: unknown, licenseId: string, usedSeats: number, status: string) { return this.root.bumpUsage(tx, licenseId, usedSeats, status); }
  findActiveSeat(licenseId: string, userId: string) { return this.root.findActiveSeat(licenseId, userId); }
  revokeSeat(tx: unknown, seatId: string) { return this.root.revokeSeat(tx, seatId); }
  releaseUsage(tx: unknown, licenseId: string) { return this.root.releaseUsage(tx, licenseId); }
  setEntitlementExpiry(tx: unknown, userId: string, productId: string, expiresAt: Date | null) {
    return this.root.setEntitlementExpiry(tx, userId, productId, expiresAt);
  }
  revokeEntitlement(tx: unknown, userId: string, productId: string) { return this.root.revokeEntitlement(tx, userId, productId); }
  allocateInvites(args: { licenseId: string; departmentId?: string; emails: string[]; lineUserIds: string[] }) {
    return this.root.allocateInvites(args);
  }
}
