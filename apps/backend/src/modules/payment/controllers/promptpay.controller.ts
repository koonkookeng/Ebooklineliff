// SSOT Phase 013 §5/Task 6 — PromptPay dynamic QR REST (generate/status/regenerate)
// Canonical: apps/backend/src/modules/payment/controllers/promptpay.controller.ts
// (legacy src/backend/modules/payment/controllers/promptpay.controller.ts)
import { Controller, Get, Post, Body, Query, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { CreatePromptPayQRInputSchema } from '@repo/shared';
import { PromptPayQrService } from '../services/promptpay-qr.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq): string {
  if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
  return req.user.id;
}

@Controller('api/payment/promptpay')
@UseGuards(JwtAuthGuard)
export class PromptPayController {
  constructor(private readonly qr: PromptPayQrService) {}

  @Post('generate')
  generate(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = CreatePromptPayQRInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid QR request payload');
    return this.qr.generateDynamicQR(actor(req), parsed.data);
  }

  @Post('regenerate')
  regenerate(@Body() body: unknown, @Req() req: AuthedReq) {
    const parsed = CreatePromptPayQRInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid QR request payload');
    return this.qr.generateDynamicQR(actor(req), parsed.data);
  }

  @Get('status')
  status(@Query('orderId') orderId: string, @Req() req: AuthedReq) {
    if (!orderId) throw new BadRequestException('Missing order id');
    return this.qr.getStatus(actor(req), orderId);
  }
}
