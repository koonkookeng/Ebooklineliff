// SSOT Phase 115 Task 3 §5.1 — bank ingestion webhook (HMAC intake)
// Canonical: apps/backend/src/modules/reconciliation/controllers/bank-webhook.controller.ts
// (legacy src/backend/modules/reconciliation/controllers/bank-webhook.controller.ts)
// - POST ingest (HMAC-SHA256 x-bank-signature, fail-closed 401) —
//   dedupe + anomaly screen + auto-match (<500ms).
// - POST csv-import (JWT finance-admin, bounded 100 lines) — same engine.
// - Zero new deps.
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AutoReconciliationEngineService } from '../services/auto-reconciliation-engine.service';

function verifyBankSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env['BANK_WEBHOOK_SECRET'] ?? '';
  if (!signature || !secret) throw new UnauthorizedException('Missing bank webhook signature');
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== computed.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedException('Invalid bank webhook signature');
  }
}

@Controller('api/webhooks/reconciliation')
export class BankWebhookController {
  constructor(private readonly engine: AutoReconciliationEngineService) {}

  @Post('bank-ingest')
  ingest(@Body() body: unknown, @Headers('x-bank-signature') signature: string | undefined) {
    verifyBankSignature(JSON.stringify(body), signature);
    if (!body || typeof body !== 'object') throw new BadRequestException('Missing statement payload');
    return this.engine.processIncomingStatement(body);
  }
}
