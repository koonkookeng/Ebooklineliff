// SSOT Phase 082 §5.1 — Tax Prisma repository (structural port + adapter)
// Canonical: apps/backend/src/modules/tax/infrastructure/repositories/tax-prisma.repository.ts
// - Profiles (upsert by userId), certificates (create/list/summary/export),
//   payout lookup for the calculate-tax BDD-1 path.
// - Structural typing (078–081 precedent). Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

export interface TaxProfileRow {
  id: string;
  userId: string;
  payerType: string;
  taxId: string;
  fullNameOrCompanyName: string;
  branchCode: string;
  address: string;
  isTaxExempt: boolean;
  verifiedAt: Date | null;
}

export interface TaxCertificateRow {
  id: string;
  certificateNo: string;
  tenantId: string | null;
  userId: string;
  formType: string;
  incomeType: string;
  grossAmount: number;
  taxWithheld: number;
  netAmount: number;
  paymentDate: Date;
  pdfStoragePathR2: string;
  pdfFileHash: string;
  isSubmittedETax: boolean;
}

export interface TaxRepository {
  withTx?(tx: unknown): TaxRepository;
  findProfile(userId: string): Promise<TaxProfileRow | null>;
  upsertProfile(args: {
    userId: string; payerType: string; taxId: string; fullNameOrCompanyName: string;
    branchCode: string; address: string; isTaxExempt: boolean;
  }): Promise<TaxProfileRow>;
  findPayout(payoutId: string): Promise<{ id: string; userId: string; grossAmount: number } | null>;
  createCertificate(args: {
    certificateNo: string; tenantId: string | null; userId: string; taxProfileId: string;
    formType: string; incomeType: string; grossAmount: number; taxWithheld: number; netAmount: number;
    pdfStoragePathR2: string; pdfFileHash: string;
  }): Promise<TaxCertificateRow>;
  findCertificate(id: string): Promise<TaxCertificateRow | null>;
  listCertificates(userId: string, limit: number): Promise<TaxCertificateRow[]>;
  annualSummary(userId: string, year: number): Promise<{ gross: number; tax: number; count: number }>;
  exportMonth(year: number, month: number): Promise<Array<{
    formType: string; certificateNo: string; payeeTaxId: string;
    grossAmount: number; taxWithheld: number; paymentDate: Date;
  }>>;
  markSubmitted(ids: string[], batchRef: string): Promise<void>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

function toRepo(db: Db): TaxRepository {
  const mapCert = (r: Record<string, unknown>): TaxCertificateRow => ({
    id: String(r['id']),
    certificateNo: String(r['certificateNo']),
    tenantId: (r['tenantId'] as string | null) ?? null,
    userId: String(r['userId']),
    formType: String(r['formType']),
    incomeType: String(r['incomeType']),
    grossAmount: toNum(r['grossAmount']),
    taxWithheld: toNum(r['taxWithheld']),
    netAmount: toNum(r['netAmount']),
    paymentDate: r['paymentDate'] as Date,
    pdfStoragePathR2: String(r['pdfStoragePathR2']),
    pdfFileHash: String(r['pdfFileHash']),
    isSubmittedETax: Boolean(r['isSubmittedETax']),
  });
  return {
    async findProfile(userId: string): Promise<TaxProfileRow | null> {
      return ((await db['userTaxProfile'].findUnique({ where: { userId } }).catch(() => null)) as TaxProfileRow | null) ?? null;
    },

    async upsertProfile(args: {
      userId: string; payerType: string; taxId: string; fullNameOrCompanyName: string;
      branchCode: string; address: string; isTaxExempt: boolean;
    }): Promise<TaxProfileRow> {
      const { userId, ...rest } = args;
      return (await db['userTaxProfile'].upsert({
        where: { userId },
        update: { ...rest },
        create: { userId, ...rest },
      })) as TaxProfileRow;
    },

    async findPayout(payoutId: string) {
      const row = (await db['payoutTransaction'].findUnique({ where: { id: payoutId } }).catch(() => null)) as {
        id: string; userId: string | null; grossAmount: unknown;
      } | null;
      if (!row || !row.userId) return null;
      return { id: row.id, userId: row.userId, grossAmount: toNum(row.grossAmount) };
    },

    async createCertificate(args: {
      certificateNo: string; tenantId: string | null; userId: string; taxProfileId: string;
      formType: string; incomeType: string; grossAmount: number; taxWithheld: number; netAmount: number;
      pdfStoragePathR2: string; pdfFileHash: string;
    }): Promise<TaxCertificateRow> {
      const row = (await db['withholdingTaxCertificate'].create({ data: { ...args } })) as Record<string, unknown>;
      return mapCert(row);
    },

    async findCertificate(id: string): Promise<TaxCertificateRow | null> {
      const row = (await db['withholdingTaxCertificate'].findUnique({ where: { id } }).catch(() => null)) as Record<string, unknown> | null;
      return row ? mapCert(row) : null;
    },

    async listCertificates(userId: string, limit: number): Promise<TaxCertificateRow[]> {
      const rows = (await db['withholdingTaxCertificate'].findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
      }).catch(() => [])) as Record<string, unknown>[];
      return rows.map(mapCert);
    },

    async annualSummary(userId: string, year: number) {
      const agg = (await db['withholdingTaxCertificate'].aggregate({
        where: {
          userId,
          paymentDate: { gte: new Date(`${year}-01-01T00:00:00Z`), lt: new Date(`${year + 1}-01-01T00:00:00Z`) },
        },
        _sum: { grossAmount: true, taxWithheld: true },
        _count: { id: true },
      }).catch(() => ({ _sum: {}, _count: { id: 0 } }))) as {
        _sum: { grossAmount: unknown; taxWithheld: unknown }; _count: { id: number };
      };
      return { gross: toNum(agg._sum.grossAmount), tax: toNum(agg._sum.taxWithheld), count: agg._count.id ?? 0 };
    },

    async exportMonth(year: number, month: number) {
      const from = new Date(Date.UTC(year, month - 1, 1));
      const to = new Date(Date.UTC(year, month, 1));
      const rows = (await db['withholdingTaxCertificate'].findMany({
        where: { paymentDate: { gte: from, lt: to } },
        include: { taxProfile: true },
        orderBy: { paymentDate: 'asc' },
      }).catch(() => [])) as Array<Record<string, unknown> & { taxProfile?: { taxId?: unknown } }>;
      return rows.map((r) => ({
        formType: String(r['formType']),
        certificateNo: String(r['certificateNo']),
        payeeTaxId: String(r['taxProfile']?.taxId ?? ''),
        grossAmount: toNum(r['grossAmount']),
        taxWithheld: toNum(r['taxWithheld']),
        paymentDate: r['paymentDate'] as Date,
      }));
    },

    async markSubmitted(ids: string[], batchRef: string): Promise<void> {
      if (ids.length === 0) return;
      await db['withholdingTaxCertificate'].updateMany({
        where: { id: { in: ids } },
        data: { isSubmittedETax: true, eTaxBatchRef: batchRef },
      });
    },
  };
}

@Injectable()
export class PrismaTaxRepository implements TaxRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): TaxRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): TaxRepository {
    return toRepo(tx as Db);
  }

  findProfile(userId: string) { return this.root.findProfile(userId); }
  upsertProfile(args: {
    userId: string; payerType: string; taxId: string; fullNameOrCompanyName: string;
    branchCode: string; address: string; isTaxExempt: boolean;
  }) { return this.root.upsertProfile(args); }
  findPayout(payoutId: string) { return this.root.findPayout(payoutId); }
  createCertificate(args: {
    certificateNo: string; tenantId: string | null; userId: string; taxProfileId: string;
    formType: string; incomeType: string; grossAmount: number; taxWithheld: number; netAmount: number;
    pdfStoragePathR2: string; pdfFileHash: string;
  }) { return this.root.createCertificate(args); }
  findCertificate(id: string) { return this.root.findCertificate(id); }
  listCertificates(userId: string, limit: number) { return this.root.listCertificates(userId, limit); }
  annualSummary(userId: string, year: number) { return this.root.annualSummary(userId, year); }
  exportMonth(year: number, month: number) {
    return this.root.exportMonth(year, month);
  }
  markSubmitted(ids: string[], batchRef: string) { return this.root.markSubmitted(ids, batchRef); }
}
