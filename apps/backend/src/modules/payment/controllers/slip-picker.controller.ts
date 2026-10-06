// SSOT Phase 016 §5.2 — Slip picker controller (analytics ingest endpoint)
// Canonical: apps/backend/src/modules/payment/controllers/slip-picker.controller.ts
// (legacy src/backend/modules/payment/slip-picker.controller.ts)
// Scope note: no presigned-url endpoint — uploads stay server-side SigV4
// (secret isolation + validated bytes + trusted sha256; see ADR-016). The
// verify-slip route stays owned by PaymentSlipController (no duplicate route).
import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { SlipPickerAnalyticsService } from '../services/slip-picker-analytics.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

@Controller('api/v1/payment')
@UseGuards(JwtAuthGuard)
export class SlipPickerController {
  constructor(private readonly analytics: SlipPickerAnalyticsService) {}

  @Post('slip-analytics')
  ingest(@Body() body: unknown, @Req() req: AuthedReq) {
    return this.analytics.handleIngest(body, req.user?.id);
  }
}
