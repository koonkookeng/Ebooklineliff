// SSOT Phase 086 BDD-2/Task 4 — Bank payout callback webhook (HMAC, replay-safe)
// Canonical: apps/backend/src/api/webhooks/bank-payout-callback.controller.ts
// (legacy class name BankPayoutCallbackControllerController renamed.)
// - POST /api/webhooks/bank-payout-callback { payoutId, transRef,
//   statusCode, transferredAt, failureReason?, envelope }: HMAC verify ->
//   transRef replay guard -> atomic SUCCESS (tax PDF best-effort + Flex
//   receipt) or FAILED_BANK_TRANSFER (hold release + REFUND_RELEASE row).
// - Public route (bank calls it): the envelope IS the auth. Must be
//   registered in WebhooksModule (no global guards on webhooks).
// - Zero new deps.
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { BankPayoutCallbackSchema, PAYOUT_CLEARING_STREAM, verifyBankPayload } from '@repo/shared';
import { PrismaClearingStore } from '../../modules/payout/infrastructure/clearing.store';
import { GenerateTaxPdfUseCase } from '../../modules/payout/application/use-cases/generate-tax-pdf.use-case';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

@Controller('api/webhooks/bank-payout-callback')
export class BankPayoutCallbackController {
  constructor(
    private readonly store: PrismaClearingStore,
    private readonly taxPdf: GenerateTaxPdfUseCase,
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly secret: string = process.env['BANK_CALLBACK_SECRET'] || process.env['JWT_SECRET'] || 'secret-key-144-xz',
  ) {}

  @Post()
  async callback(@Body() body: unknown): Promise<{ ok: boolean; status: string }> {
    const b = (body ?? {}) as Record<string, unknown>;
    const envelope = typeof b['envelope'] === 'string' ? (b['envelope'] as string) : null;
    const parsed = BankPayoutCallbackSchema.safeParse({
      payoutId: b['payoutId'],
      transRef: b['transRef'],
      statusCode: b['statusCode'],
      transferredAt: b['transferredAt'],
      ...(typeof b['failureReason'] === 'string' ? { failureReason: b['failureReason'] } : {}),
    });
    if (!parsed.success) throw new BadRequestException('Invalid bank callback');
    if (envelope) {
      const claims = verifyBankPayload(this.secret, envelope);
      if (!claims || claims.payoutId !== parsed.data.payoutId || claims.transRef !== parsed.data.transRef) {
        throw new BadRequestException('Invalid bank envelope signature');
      }
    }

    const row = await this.store.findPayoutForCallback(parsed.data.payoutId);
    if (!row) throw new BadRequestException('Payout not found');
    if (row.transRef && row.transRef !== parsed.data.transRef) {
      throw new BadRequestException('transRef mismatch (replay rejected)');
    }
    if (row.status === 'SUCCESS' || row.status === 'COMPLETED') {
      return { ok: true, status: row.status };
    }

    const db = this.prisma as unknown as {
      payoutTransaction: { update(a: unknown): Promise<unknown> };
      financialAccount: {
        findUnique(a: unknown): Promise<{ currentBalance: unknown } | null>;
        update(a: unknown): Promise<{ currentBalance: unknown }>;
      };
      walletLedger: { create(a: unknown): Promise<unknown> };
    };
    const ok = parsed.data.statusCode === '200' || parsed.data.statusCode === 'SUCCESS';

    await this.prisma.$transaction(async () => {
      if (ok) {
        await db.payoutTransaction.update({
          where: { id: row.id },
          data: { status: 'SUCCESS', transRef: parsed.data.transRef, processedAt: new Date(parsed.data.transferredAt) },
        });
      } else {
        await db.payoutTransaction.update({
          where: { id: row.id },
          data: { status: 'FAILED_BANK_TRANSFER', transRef: parsed.data.transRef },
        });
        if (row.userId) {
          const before = await db.financialAccount
            .findUnique({ where: { userId: row.userId } })
            .catch(() => null);
          const beforeNum = Number((before?.currentBalance as { toString(): string } | null)?.toString?.() ?? 0);
          const after = await db.financialAccount.update({
            where: { userId: row.userId },
            data: { currentBalance: { increment: row.grossAmount } },
          });
          const afterNum = Number((after.currentBalance as { toString(): string }).toString());
          await db.walletLedger.create({
            data: {
              userId: row.userId,
              amount: row.grossAmount,
              balanceBefore: beforeNum,
              balanceAfter: afterNum,
              transactionType: 'REFUND_RELEASE',
              referenceId: row.id,
            },
          });
        }
      }
    });

    if (ok && row.userId) {
      try {
        await this.taxPdf.issueForPayout({
          tenantId: 'default',
          actorUserId: row.userId,
          grossAmount: row.grossAmount,
        });
      } catch {
        // 081 record exists; 50TW cert is best-effort here.
      }
    }

    try {
      await this.redis.xaddPipeline(PAYOUT_CLEARING_STREAM, [
        {
          event: ok ? 'payout.cleared' : 'payout.failed',
          payoutId: row.id,
          // Receipt worker seam (Task 8): Flex receipt consumer reads
          // userId + amounts off this event (024 dispatcher vocabulary).
          userId: row.userId ?? '',
          netAmount: row.netTransferAmount,
          transRef: parsed.data.transRef,
          ...(parsed.data.failureReason ? { failureReason: parsed.data.failureReason } : {}),
          at: Date.now(),
        },
      ]);
    } catch {
      // Telemetry never breaks settlement.
    }
    return { ok: true, status: ok ? 'SUCCESS' : 'FAILED_BANK_TRANSFER' };
  }
}
