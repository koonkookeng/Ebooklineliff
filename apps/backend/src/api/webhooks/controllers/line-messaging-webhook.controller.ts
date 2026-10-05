// SSOT Phase 004 Task 004.7 — LINE messaging webhook (event ACK; Flex push = Phase 034/079)
import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { LineSignatureGuard } from '../guards/line-signature.guard';

@Controller('webhooks/line')
export class LineMessagingWebhookController {
  @Post('messaging')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LineSignatureGuard)
  async handleMessaging(@Body() body: { events?: unknown[] }) {
    return { status: 'RECEIVED', events: body?.events?.length ?? 0 };
  }
}
