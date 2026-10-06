// SSOT Phase 019 Task 6 — Receipt REST seam (auto + manual receipt delivery)
// Canonical: apps/backend/src/modules/payment/payment-slip.controller.ts
// (legacy src/backend/modules/payment/payment-slip.controller.ts)
// Ownership-checked buyer endpoints; the automatic path needs no endpoint — the
// queue processor subscribes to the verified-payment flex events (§BDD scenario 1).
import { Controller, Get, Post, Param, Query, Body, Req, Res, UseGuards, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { LineMessagingService } from '../notification/line-messaging.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

// Minimal reply typing: works on Fastify without importing 'fastify' types.
interface RedirectReply {
  redirect: (code: number, url: string) => unknown;
}

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq): string {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  return req.user.id;
}

const RequestSchema = z.object({
  orderId: z.string().uuid(),
  force: z.boolean().optional(),
});

@Controller('api/receipts')
@UseGuards(JwtAuthGuard)
export class PaymentSlipController {
  constructor(private readonly receipts: LineMessagingService) {}

  /** Manual (re-)request: buyer pulls the receipt for their own order. */
  @Post('request')
  request(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid receipt request');
    return this.receipts.requestReceipt(parsed.data.orderId, undefined, parsed.data.force ?? false, actor(req));
  }

  /** Receipt page data (order must belong to the caller). */
  @Get('order/:orderId')
  detail(@Param('orderId') orderId: string, @Req() req: AuthedReq) {
    if (!orderId) throw new BadRequestException('Missing order id');
    return this.receipts.getReceiptForOrder(orderId, actor(req));
  }

  /** HMAC-gated PDF download → 302 zero-egress R2 object. */
  @Get('download')
  async download(@Query('logId') logId: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: RedirectReply) {
    const expNum = Number.parseInt(exp ?? '', 10);
    if (!logId || !Number.isInteger(expNum) || !sig) throw new BadRequestException('Invalid download ticket');
    const url = await this.receipts.resolveDownload(logId, expNum, sig).catch(() => null);
    if (!url) throw new NotFoundException('Receipt not found');
    void res.redirect(302, url);
  }
}
