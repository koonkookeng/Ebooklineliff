// SSOT Phase 081 §5.1 — Ledger repository port + structural Prisma adapter
// Canonical: apps/backend/src/modules/finance/infrastructure/prisma-ledger.repository.ts
// - Append-only by construction (§8.3): create paths only, no update/delete
//   for journals or entries (balance moves via new entries + account
//   increments inside one $transaction).
// - Structural typing (078/079/080 precedent). Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface FinanceOrderRow {
  orderId: string;
  userId: string;
  paymentStatus: string;
  netAmount: number;
}

export interface CommissionRuleRow {
  platformFeePercent: number;
  tier1Percent: number;
  tier2Percent: number;
}

export interface LedgerRepository {
  withTx?(tx: unknown): LedgerRepository;
  findOrder(orderId: string): Promise<FinanceOrderRow | null>;
  commissionRule(productId: string | null): Promise<CommissionRuleRow>;
  hasJournalForOrder(orderId: string): Promise<boolean>;
  createJournal(args: { referenceOrderId: string; description: string; eventPayload: unknown }): Promise<{ id: string }>;
  ensureUserAccount(userId: string, accountType: string, opening: number): Promise<{ id: string; balance: number }>;
  ensurePlatformAccount(accountType: string): Promise<{ id: string; balance: number }>;
  postEntry(args: {
    journalId: string;
    debitAccountId: string | null;
    creditAccountId: string | null;
    amount: number;
    entryType: 'DEBIT' | 'CREDIT';
    runningBalance: number;
  }): Promise<void>;
  adjustUserBalance(userId: string, delta: number): Promise<number>;
  userBalance(userId: string): Promise<number>;
  createPayout(args: {
    payoutNo: string;
    userId: string;
    grossAmount: number;
    taxRatePercent: number;
    taxWithheldAmount: number;
    netTransferAmount: number;
    bankAccountDetail: unknown;
  }): Promise<{ id: string }>;
  findPayout(payoutId: string): Promise<{
    id: string; userId: string; grossAmount: number; taxWithheldAmount: number;
    netTransferAmount: number; status: string;
  } | null>;
  markPayoutStatus(payoutId: string, status: string): Promise<void>;
  createTaxRecord(args: {
    payoutTransactionId: string;
    taxCertificateNo: string;
    taxId: string;
    payeeName: string;
    payeeAddress: string;
    grossAmount: number;
    taxAmount: number;
    pdfStoragePathR2: string;
  }): Promise<void>;
  statementPage(args: { userId: string; limit: number; offset: number }): Promise<{
    items: Array<{ id: string; createdAt: Date; description: string; debit: number; credit: number; referenceOrderId: string | null }>;
    totalCount: number;
  }>;
  lifetimeTotals(userId: string): Promise<{ earned: number; taxWithheld: number; commissionPaid: number }>;
  systemDiscrepancy(): Promise<number>;
}

type Db = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;

const toNum = (v: unknown): number => Number((v as { toString(): string } | null)?.toString?.() ?? 0);

function toRepo(db: Db): LedgerRepository {
  return {
    async findOrder(orderId: string): Promise<FinanceOrderRow | null> {
      const o = (await db['order'].findUnique({ where: { id: orderId } }).catch(() => null)) as {
        id: string; userId: string; paymentStatus: string; netAmount: unknown;
      } | null;
      if (!o) return null;
      return { orderId: o.id, userId: o.userId, paymentStatus: o.paymentStatus, netAmount: toNum(o.netAmount) };
    },

    async commissionRule(productId: string | null): Promise<CommissionRuleRow> {
      if (productId) {
        const scoped = (await db['commissionRule'].findUnique({ where: { productId } }).catch(() => null)) as {
          platformFeePercent: unknown; tier1Percent: unknown; tier2Percent: unknown;
        } | null;
        if (scoped) {
          return { platformFeePercent: toNum(scoped.platformFeePercent), tier1Percent: toNum(scoped.tier1Percent), tier2Percent: toNum(scoped.tier2Percent) };
        }
      }
      const global = (await db['commissionRule'].findFirst({ where: { productId: null } }).catch(() => null)) as {
        platformFeePercent: unknown; tier1Percent: unknown; tier2Percent: unknown;
      } | null;
      if (global) {
        return { platformFeePercent: toNum(global.platformFeePercent), tier1Percent: toNum(global.tier1Percent), tier2Percent: toNum(global.tier2Percent) };
      }
      return { platformFeePercent: 5, tier1Percent: 10, tier2Percent: 2 };
    },

    async hasJournalForOrder(orderId: string): Promise<boolean> {
      const n = (await db['ledgerJournal'].count({ where: { referenceOrderId: orderId } }).catch(() => 0)) as number;
      return (n ?? 0) > 0;
    },

    async createJournal(args: { referenceOrderId: string; description: string; eventPayload: unknown }): Promise<{ id: string }> {
      return (await db['ledgerJournal'].create({ data: { ...args } })) as { id: string };
    },

    async ensureUserAccount(userId: string, accountType: string, opening: number): Promise<{ id: string; balance: number }> {
      const row = (await db['financialAccount'].upsert({
        where: { userId },
        update: { currentBalance: { increment: opening } },
        create: { userId, accountType, currentBalance: opening },
      })) as { id: string; currentBalance: unknown };
      return { id: row.id, balance: toNum(row.currentBalance) };
    },

    async ensurePlatformAccount(accountType: string): Promise<{ id: string; balance: number }> {
      const existing = (await db['financialAccount'].findFirst({
        where: { userId: null, accountType },
      }).catch(() => null)) as { id: string; currentBalance: unknown } | null;
      if (existing) return { id: existing.id, balance: toNum(existing.currentBalance) };
      try {
        const created = (await db['financialAccount'].create({
          data: { userId: null, accountType, currentBalance: 0 },
        })) as { id: string; currentBalance: unknown };
        return { id: created.id, balance: 0 };
      } catch {
        // Same-ms double seed (multi-order race) → read the winner's row.
        const winner = (await db['financialAccount'].findFirst({
          where: { userId: null, accountType },
        })) as { id: string; currentBalance: unknown };
        return { id: winner.id, balance: toNum(winner.currentBalance) };
      }
    },

    async postEntry(args: {
      journalId: string; debitAccountId: string | null; creditAccountId: string | null;
      amount: number; entryType: 'DEBIT' | 'CREDIT'; runningBalance: number;
    }): Promise<void> {
      await db['ledgerEntry'].create({ data: { ...args } });
    },

    async adjustUserBalance(userId: string, delta: number): Promise<number> {
      const row = (await db['financialAccount'].update({
        where: { userId },
        data: { currentBalance: { increment: delta } },
      })) as { currentBalance: unknown };
      return toNum(row.currentBalance);
    },

    async userBalance(userId: string): Promise<number> {
      const row = (await db['financialAccount'].findUnique({ where: { userId } }).catch(() => null)) as {
        currentBalance: unknown;
      } | null;
      return toNum(row?.currentBalance ?? 0);
    },

    async createPayout(args: {
      payoutNo: string; userId: string; grossAmount: number; taxRatePercent: number;
      taxWithheldAmount: number; netTransferAmount: number; bankAccountDetail: unknown;
    }): Promise<{ id: string }> {
      return (await db['payoutTransaction'].create({
        data: {
          ...args,
          withholdingTax: args.taxWithheldAmount,
          processingFee: 0,
          netAmount: args.netTransferAmount,
        },
      })) as { id: string };
    },

    async findPayout(payoutId: string) {
      const row = (await db['payoutTransaction'].findUnique({ where: { id: payoutId } }).catch(() => null)) as {
        id: string; userId: string | null; grossAmount: unknown; taxWithheldAmount: unknown;
        netTransferAmount: unknown; status: string;
      } | null;
      if (!row || !row.userId) return null;
      return {
        id: row.id,
        userId: row.userId,
        grossAmount: toNum(row.grossAmount),
        taxWithheldAmount: toNum(row.taxWithheldAmount),
        netTransferAmount: toNum(row.netTransferAmount),
        status: row.status,
      };
    },

    async markPayoutStatus(payoutId: string, status: string): Promise<void> {
      await db['payoutTransaction'].update({ where: { id: payoutId }, data: { status } });
    },

    async createTaxRecord(args: {
      payoutTransactionId: string; taxCertificateNo: string; taxId: string; payeeName: string;
      payeeAddress: string; grossAmount: number; taxAmount: number; pdfStoragePathR2: string;
    }): Promise<void> {
      await db['withholdingTaxRecord'].create({ data: { ...args } });
    },

    async statementPage(args: { userId: string; limit: number; offset: number }) {
      const account = (await db['financialAccount'].findUnique({ where: { userId: args.userId } }).catch(() => null)) as {
        id: string;
      } | null;
      if (!account) return { items: [], totalCount: 0 };
      const where = { OR: [{ debitAccountId: account.id }, { creditAccountId: account.id }] };
      const [rows, totalCount] = (await Promise.all([
        db['ledgerEntry'].findMany({
          where,
          include: { journal: true },
          orderBy: { createdAt: 'desc' },
          take: Math.min(args.limit, 100),
          skip: args.offset,
        }),
        db['ledgerEntry'].count({ where }),
      ]).catch(() => [[], 0])) as unknown as [Array<{
        id: string; createdAt: Date; amount: unknown; entryType: string;
        debitAccountId: string | null;
        journal: { description: string; referenceOrderId: string | null } | null;
      }>, number];
      return {
        items: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          description: r.journal?.description ?? '',
          debit: r.entryType === 'DEBIT' ? toNum(r.amount) : 0,
          credit: r.entryType === 'CREDIT' ? toNum(r.amount) : 0,
          referenceOrderId: r.journal?.referenceOrderId ?? null,
        })),
        totalCount: totalCount ?? 0,
      };
    },

    async lifetimeTotals(userId: string) {
      const [earned, tax] = (await Promise.all([
        db['ledgerEntry'].aggregate({
          where: { creditAccount: { userId }, entryType: 'CREDIT' },
          _sum: { amount: true },
        }),
        db['payoutTransaction'].aggregate({
          where: { userId, status: { in: ['SUCCESS', 'PROCESSING_BANK'] } },
          _sum: { taxWithheldAmount: true },
        }),
      ]).catch(() => [{ _sum: {} }, { _sum: {} }])) as unknown as [
        { _sum: { amount: unknown } },
        { _sum: { taxWithheldAmount: unknown } },
      ];
      return {
        earned: toNum(earned._sum.amount),
        taxWithheld: toNum(tax._sum.taxWithheldAmount),
        commissionPaid: 0,
      };
    },

    async systemDiscrepancy(): Promise<number> {
      const [debits, credits] = (await Promise.all([
        db['ledgerEntry'].aggregate({ where: { entryType: 'DEBIT' }, _sum: { amount: true } }),
        db['ledgerEntry'].aggregate({ where: { entryType: 'CREDIT' }, _sum: { amount: true } }),
      ]).catch(() => [{ _sum: {} }, { _sum: {} }])) as unknown as [
        { _sum: { amount: unknown } },
        { _sum: { amount: unknown } },
      ];
      return Math.round((toNum(debits._sum.amount) - toNum(credits._sum.amount)) * 100) / 100;
    },
  };
}

@Injectable()
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get root(): LedgerRepository {
    return toRepo(this.prisma as unknown as Db);
  }

  withTx(tx: unknown): LedgerRepository {
    return toRepo(tx as Db);
  }

  findOrder(orderId: string) { return this.root.findOrder(orderId); }
  commissionRule(productId: string | null) { return this.root.commissionRule(productId); }
  hasJournalForOrder(orderId: string) { return this.root.hasJournalForOrder(orderId); }
  createJournal(args: { referenceOrderId: string; description: string; eventPayload: unknown }) {
    return this.root.createJournal(args);
  }
  ensureUserAccount(userId: string, accountType: string, opening: number) {
    return this.root.ensureUserAccount(userId, accountType, opening);
  }
  ensurePlatformAccount(accountType: string) { return this.root.ensurePlatformAccount(accountType); }
  postEntry(args: {
    journalId: string; debitAccountId: string | null; creditAccountId: string | null;
    amount: number; entryType: 'DEBIT' | 'CREDIT'; runningBalance: number;
  }) { return this.root.postEntry(args); }
  adjustUserBalance(userId: string, delta: number) { return this.root.adjustUserBalance(userId, delta); }
  userBalance(userId: string) { return this.root.userBalance(userId); }
  createPayout(args: {
    payoutNo: string; userId: string; grossAmount: number; taxRatePercent: number;
    taxWithheldAmount: number; netTransferAmount: number; bankAccountDetail: unknown;
  }) { return this.root.createPayout(args); }
  findPayout(payoutId: string) { return this.root.findPayout(payoutId); }
  markPayoutStatus(payoutId: string, status: string) { return this.root.markPayoutStatus(payoutId, status); }
  createTaxRecord(args: {
    payoutTransactionId: string; taxCertificateNo: string; taxId: string; payeeName: string;
    payeeAddress: string; grossAmount: number; taxAmount: number; pdfStoragePathR2: string;
  }) { return this.root.createTaxRecord(args); }
  statementPage(args: { userId: string; limit: number; offset: number }) {
    return this.root.statementPage(args);
  }
  lifetimeTotals(userId: string) { return this.root.lifetimeTotals(userId); }
  systemDiscrepancy() { return this.root.systemDiscrepancy(); }
}
