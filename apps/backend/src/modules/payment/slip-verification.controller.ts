// SSOT Phase 014 §5.4 — v1 payment slip controller (spec route + Zod boundary)
// Canonical: apps/backend/src/modules/payment/slip-verification.controller.ts
// (legacy src/backend/modules/payment/slip-verification.controller.ts)
import { Controller, Post, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import type { SlipVerificationResponse } from '@repo/shared';
import { SlipVerificationService } from './slip-verification.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

@Controller('api/v1/payment')
@UseGuards(JwtAuthGuard)
export class PaymentSlipController {
  constructor(private readonly slipService: SlipVerificationService) {}

  @Post('verify-slip')
  @HttpCode(HttpStatus.OK)
  verifySlip(@Body() body: unknown, @Req() req: AuthedReq): Promise<SlipVerificationResponse> {
    return this.slipService.handleVerifyRequest(body, req.user?.id);
  }
}
