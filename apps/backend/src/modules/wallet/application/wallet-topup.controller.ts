// SSOT Phase 017 Task 4 — Instant auto top-up handler (EasySlip webhook → wallet credit)
// Canonical: apps/backend/src/modules/wallet/application/wallet-topup.controller.ts
// (legacy src/backend/modules/wallet/application/wallet-topup.controller.ts)
// Flow: slipImageUrl → EasySlip verify (<800ms) → amount/transRef/account guard →
// atomic topupFromSlip (TOPUP + BONUS ledgers) → Flex notify. Idempotent on transRef.
import { Controller, Post, Get, Query, Body, BadRequestException, Headers, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { WalletService } from './wallet.service';
import { EasySlipVerifyAdapter } from '../../payment/services/easyslip-verify.adapter';
import { topupBonus, topupTotal } from '../domain/wallet-calculator';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq): string {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  return req.user.id;
}

const TopupWebhookSchema = z.object({
  userId: z.string().min(1),
  slipImageUrl: z.string().url(),
  promotionCode: z.string().max(64).optional(),
  bonusRate: z.number().min(0).max(0.5).optional(),
});

@Controller('api/wallet')
export class WalletTopupController {
  constructor(
    private readonly wallet: WalletService,
    private readonly easyslip: EasySlipVerifyAdapter,
  ) {}

  @Post('topup/from-slip')
  async topupFromSlip(@Body() body: unknown, @Headers('x-tenant-id') tenant?: string) {
    const parsed = TopupWebhookSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid top-up webhook payload');
    void tenant;
    const slip = await this.easyslip.verify(parsed.data.slipImageUrl);
    const expectedAccount = (process.env.COMPANY_PROMPTPAY_ACCOUNT ?? '').replace(/\D/g, '');
    if (expectedAccount && slip.receiverAccount !== expectedAccount) {
      throw new BadRequestException('Recipient account does not match enterprise account');
    }
    return this.wallet.topupFromSlip(parsed.data.userId, slip.amount, slip.transRef, {
      promotionCode: parsed.data.promotionCode,
      bonusRate: parsed.data.bonusRate,
    });
  }

  @Post('topup/preview-bonus')
  preview(@Body() body: unknown) {
    const parsed = z.object({ amount: z.number().positive().min(20) }).safeParse(body);
    if (!parsed.success) throw new BadRequestException('ขั้นต่ำในการเติมเงินคือ 20 บาท');
    return { amount: parsed.data.amount, bonusAmount: topupBonus(parsed.data.amount), total: topupTotal(parsed.data.amount) };
  }

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  balance(@Req() req: AuthedReq) {
    return this.wallet.getBalance(actor(req));
  }

  @Get('ledger')
  @UseGuards(JwtAuthGuard)
  ledger(@Req() req: AuthedReq, @Query('take') take?: string) {
    const n = take ? Number.parseInt(take, 10) : 20;
    return this.wallet.ledger(actor(req), Number.isFinite(n) ? n : 20);
  }

  @Post('one-click-buy')
  @UseGuards(JwtAuthGuard)
  oneClick(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = z.object({ productId: z.string().uuid(), expectedPrice: z.number().positive(), tenantId: z.string().min(1).optional() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid one-click payload');
    return this.wallet.executeOneClickBuy(actor(req), parsed.data.productId, parsed.data.expectedPrice, parsed.data.tenantId ?? 'default');
  }
}
