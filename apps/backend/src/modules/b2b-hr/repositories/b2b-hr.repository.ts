// SSOT Phase 098 §5.1 — B2B HR repository port + Prisma adapter (single seam)
// Canonical: apps/backend/src/modules/b2b-hr/repositories/b2b-hr.repository.ts
// - RISK_CALL: port + adapter co-located (spec tree has no domain/ layer —
//   single-file seam keeps the tree canonical, same as 097). Mutations run
//   inside caller-owned $transactions (Gate 7).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface HrOrganizationRow {
  id: string;
  companyName: string;
  taxId: string | null;
  logoUrl: string | null;
  totalSeats: number;
  usedSeats: number;
}

export interface HrSeatRow {
  id: string;
  organizationId: string;
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  employeeEmail: string;
  employeeName: string | null;
  status: string;
}

export interface HrQuizAttemptRow {
  id: string;
  seatId: string;
  courseId: string;
  quizId: string;
  scoreObtained: number;
  maxScore: number;
  isPassed: boolean;
  timeTakenSec: number;
  completedAt: Date;
}

export interface B2bHrRepository {
  findOrganization(orgId: string): Promise<HrOrganizationRow | null>;
  findSeat(seatId: string): Promise<HrSeatRow | null>;
  bumpOrgUsage(organizationId: string, delta: number): Promise<{ usedSeats: number; totalSeats: number }>;
  allocateSeats(args: {
    organizationId: string;
    departmentId?: string;
    emails: string[];
    lineUserIds: string[];
  }): Promise<{ invited: number; organizationId: string }>;
  activateSeat(args: { seatId: string; userId: string }): Promise<HrSeatRow>;
  revokeSeat(seatId: string): Promise<{ organizationId: string }>;
  listSeats(organizationId: string): Promise<HrSeatRow[]>;
  recordQuizAttempt(args: {
    seatId: string;
    courseId: string;
    quizId: string;
    scoreObtained: number;
    maxScore: number;
    isPassed: boolean;
    timeTakenSec: number;
  }): Promise<HrQuizAttemptRow>;
  listQuizAttempts(seatIds: string[]): Promise<HrQuizAttemptRow[]>;
  withTx?(tx: unknown): B2bHrRepository;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

function mapQuiz(row: Record<string, unknown>): HrQuizAttemptRow {
  return {
    id: row['id'] as string,
    seatId: row['seatId'] as string,
    courseId: row['courseId'] as string,
    quizId: row['quizId'] as string,
    scoreObtained: toNum(row['scoreObtained']),
    maxScore: toNum(row['maxScore']),
    isPassed: row['isPassed'] as boolean,
    timeTakenSec: row['timeTakenSec'] as number,
    completedAt: row['completedAt'] as Date,
  };
}

function toRepo(db: Db): B2bHrRepository {
  const orgs = db['b2BOrganization'];
  const seats = db['b2BCorporateSeat'];
  const attempts = db['b2BQuizAttempt'];
  return {
    async findOrganization(orgId: string): Promise<HrOrganizationRow | null> {
      const row = (await orgs.findUnique({ where: { id: orgId } }).catch(() => null)) as unknown as HrOrganizationRow | null;
      return row;
    },

    async findSeat(seatId: string): Promise<HrSeatRow | null> {
      const row = (await seats
        .findUnique({ where: { id: seatId }, include: { department: true } })
        .catch(() => null)) as unknown as Record<string, unknown> | null;
      if (!row) return null;
      return {
        id: row['id'] as string,
        organizationId: row['organizationId'] as string,
        departmentId: (row['departmentId'] as string | null) ?? null,
        departmentName: ((row['department'] as { name?: string } | null)?.name as string | undefined) ?? null,
        userId: (row['userId'] as string | null) ?? null,
        employeeEmail: row['employeeEmail'] as string,
        employeeName: (row['employeeName'] as string | null) ?? null,
        status: row['status'] as string,
      };
    },

    async bumpOrgUsage(organizationId: string, delta: number) {
      const current = (await orgs.findUnique({ where: { id: organizationId } })) as unknown as {
        usedSeats: number;
        totalSeats: number;
      };
      const next = current.usedSeats + delta;
      if (next < 0 || next > current.totalSeats) {
        throw new Error(next < 0 ? 'Seat counter underflow' : 'No available seats in organization pool');
      }
      const row = (await orgs.update({
        where: { id: organizationId },
        data: { usedSeats: next },
      })) as unknown as { usedSeats: number; totalSeats: number };
      return { usedSeats: row.usedSeats, totalSeats: row.totalSeats };
    },

    async allocateSeats(args) {
      // Single batch: INVITED rows for emails + LINE ids (pool counter
      // moves on activation, BDD-1 50/50 sync reads usedSeats/totalSeats).
      for (const email of args.emails) {
        await seats.create({
          data: {
            organizationId: args.organizationId,
            departmentId: args.departmentId,
            employeeEmail: email,
            status: 'INVITED',
          },
        });
      }
      for (const lineUserId of args.lineUserIds) {
        await seats.create({
          data: {
            organizationId: args.organizationId,
            departmentId: args.departmentId,
            employeeEmail: `${lineUserId}@line.local`,
            employeeName: lineUserId,
            status: 'INVITED',
          },
        });
      }
      return { invited: args.emails.length + args.lineUserIds.length, organizationId: args.organizationId };
    },

    async activateSeat(args: { seatId: string; userId: string }): Promise<HrSeatRow> {
      const row = (await seats.update({
        where: { id: args.seatId },
        data: { userId: args.userId, status: 'ACTIVE' },
        include: { department: true },
      })) as unknown as Record<string, unknown>;
      return {
        id: row['id'] as string,
        organizationId: row['organizationId'] as string,
        departmentId: (row['departmentId'] as string | null) ?? null,
        departmentName: ((row['department'] as { name?: string } | null)?.name as string | undefined) ?? null,
        userId: (row['userId'] as string | null) ?? null,
        employeeEmail: row['employeeEmail'] as string,
        employeeName: (row['employeeName'] as string | null) ?? null,
        status: row['status'] as string,
      };
    },

    async revokeSeat(seatId: string) {
      const row = (await seats.update({
        where: { id: seatId },
        data: { status: 'REVOKED', userId: null },
      })) as unknown as { organizationId: string };
      return { organizationId: row.organizationId };
    },

    async listSeats(organizationId: string): Promise<HrSeatRow[]> {
      const rows = (await seats
        .findMany({ where: { organizationId }, include: { department: true } })
        .catch(() => [])) as unknown as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row['id'] as string,
        organizationId: row['organizationId'] as string,
        departmentId: (row['departmentId'] as string | null) ?? null,
        departmentName: ((row['department'] as { name?: string } | null)?.name as string | undefined) ?? null,
        userId: (row['userId'] as string | null) ?? null,
        employeeEmail: row['employeeEmail'] as string,
        employeeName: (row['employeeName'] as string | null) ?? null,
        status: row['status'] as string,
      }));
    },

    async recordQuizAttempt(args): Promise<HrQuizAttemptRow> {
      const row = (await attempts.create({ data: { ...args } })) as unknown as Record<string, unknown>;
      return mapQuiz(row);
    },

    async listQuizAttempts(seatIds: string[]): Promise<HrQuizAttemptRow[]> {
      if (seatIds.length === 0) return [];
      const rows = (await attempts
        .findMany({ where: { seatId: { in: seatIds } } })
        .catch(() => [])) as unknown as Array<Record<string, unknown>>;
      return rows.map(mapQuiz);
    },
  };
}

@Injectable()
export class PrismaB2bHrRepository implements B2bHrRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): B2bHrRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): B2bHrRepository {
    return toRepo(tx as Db);
  }

  findOrganization(orgId: string) { return this.root.findOrganization(orgId); }
  findSeat(seatId: string) { return this.root.findSeat(seatId); }
  bumpOrgUsage(organizationId: string, delta: number) { return this.root.bumpOrgUsage(organizationId, delta); }
  allocateSeats(args: { organizationId: string; departmentId?: string; emails: string[]; lineUserIds: string[] }) {
    return this.root.allocateSeats(args);
  }
  activateSeat(args: { seatId: string; userId: string }) { return this.root.activateSeat(args); }
  revokeSeat(seatId: string) { return this.root.revokeSeat(seatId); }
  listSeats(organizationId: string) { return this.root.listSeats(organizationId); }
  recordQuizAttempt(args: {
    seatId: string; courseId: string; quizId: string;
    scoreObtained: number; maxScore: number; isPassed: boolean; timeTakenSec: number;
  }) { return this.root.recordQuizAttempt(args); }
  listQuizAttempts(seatIds: string[]) { return this.root.listQuizAttempts(seatIds); }
}
