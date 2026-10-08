// SSOT Phase 077 BDD-2 — Carrier webhook controller (public HMAC endpoint)
// Canonical: apps/backend/src/api/webhooks/logistics-carrier.controller.ts
// (legacy src/backend/api/webhooks/logistics-carrier.controller.ts)
// - POST /api/v1/webhooks/logistics/carrier-update (global prefix applies).
//   Public route: trust comes from per-tenant HMAC + replay guard, not JWT.
// - Zero new deps.
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CarrierWebhookService } from '../../modules/logistics/services/carrier-webhook.service';

@Controller('webhooks/logistics')
export class LogisticsCarrierController {
  constructor(private readonly webhooks: CarrierWebhookService) {}

  @Post('carrier-update')
  @HttpCode(HttpStatus.OK)
  handleCarrierWebhook(@Body() rawBody: unknown) {
    return this.webhooks.ingest(rawBody);
  }
}
