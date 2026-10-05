// SSOT Phase 004 Task 004.7 — carrier logistics webhook (status relay; full engine = Phase 077)
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';

@Controller('webhooks/logistics')
export class LogisticsWebhookController {
  @Post('carrier')
  @HttpCode(HttpStatus.OK)
  async handleCarrierUpdate(@Body() body: { trackingId?: string; status?: string }) {
    return { status: 'RECEIVED', trackingId: body?.trackingId ?? null };
  }
}
