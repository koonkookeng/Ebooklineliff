// SSOT Phase 012 BDD — Slip verify REST (<1s atomic path; webhook stays EasySlip-owner)
// Canonical: apps/backend/src/modules/order/presentation/rest/slip-verify.controller.ts
import { Controller, Post, Body, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { VerifySlipInputSchema } from '@repo/shared';
import { SlipVerifyService } from '../../services/slip-verify.service';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

@Controller('api/payment')
@UseGuards(JwtAuthGuard)
export class SlipVerifyController {
  constructor(private readonly slipVerify: SlipVerifyService) {}

  @Post('verify-slip')
  verify(@Body() body: unknown, @Req() req: AuthedReq) {
    if (!req.user?.id) throw new UnauthorizedException('Unauthorized');
    const parsed = VerifySlipInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid slip verification payload');
    return this.slipVerify.verify(parsed.data.orderId, parsed.data.slipImageUrl, req.user.id);
  }
}
