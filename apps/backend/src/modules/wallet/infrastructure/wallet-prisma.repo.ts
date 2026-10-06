// SSOT Phase 017 §5 — Wallet persistence repository (Prisma thin adapter)
// Canonical: apps/backend/src/modules/wallet/infrastructure/wallet-prisma.repo.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { toNum } from '../domain/wallet.entity';

export interface WalletBalance {
  walletId: string;
  mainBalance: number;
  bonusBalance: number;
  totalBalance: number;
}

type WalletClient = {
  wallet: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
  };
  walletLedger: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

@Injectable()
export class WalletPrismaRepo {
  constructor(private readonly prisma: PrismaService) {}

  private client(): WalletClient {
    return this.prisma as unknown as WalletClient;
  }

  async findByUserId(userId: string): Promise<Record<string, unknown> | null> {
    return this.client().wallet.findUnique({ where: { userId } }).catch(() => null);
  }

  async getOrCreate(userId: string): Promise<Record<string, unknown>> {
    return this.client().wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, mainBalance: 0, bonusBalance: 0 },
    });
  }

  toBalance(row: Record<string, unknown>): WalletBalance {
    const main = toNum(row['mainBalance'], 0);
    const bonus = toNum(row['bonusBalance'], 0);
    return {
      walletId: String(row['id']),
      mainBalance: main,
      bonusBalance: bonus,
      totalBalance: Math.round((main + bonus) * 100) / 100,
    };
  }

  async ledgerHistory(walletId: string, take = 20): Promise<Array<Record<string, unknown>>> {
    return this.client()
      .walletLedger.findMany({ where: { walletId }, orderBy: { createdAt: 'desc' }, take })
      .catch(() => []);
  }
}
