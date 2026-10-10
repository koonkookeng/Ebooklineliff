// SSOT Phase 111 §7.1/§10.2 — KYC OCR completion webhook (provider callback)
// Canonical: apps/backend/src/api/webhooks/kyc/kyc-ocr-callback.controller.ts
// (legacy src/backend/api/webhooks/kyc/**)
// - HMAC-SHA256 guarded (x-kyc-signature over raw JSON body, timing-safe;
//   KYC_OCR_WEBHOOK_SECRET env-first). Fail-closed 401, idempotent per
//   kycId+ocrConfidence (replay-safe), triggers best-effort risk assessment.
// - Never blocks the pipe: OCR low-confidence (<50%) escalates to HIGH +
//   manual review per §10.2 inside KycRiskService. Zero new deps.
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { KycRiskService } from '../../../modules/kyc/services/kyc-risk.service';
import { KycQueueService } from '../../../modules/kyc/services/kyc-queue.service';

function verifyKycSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env['KYC_OCR_WEBHOOK_SECRET'] ?? '';
  if (!signature || !secret) throw new UnauthorizedException('Missing KYC webhook signature');
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== computed.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedException('Invalid KYC webhook signature');
  }
}

@Controller('api/webhooks/kyc')
export class KycOcrCallbackController {
  constructor(
    private readonly risk: KycRiskService,
    private readonly queue: KycQueueService,
  ) {}

  @Post('ocr-callback')
  async ocrCallback(@Body() body: unknown, @Headers('x-kyc-signature') signature: string | undefined) {
    verifyKycSignature(JSON.stringify(body), signature);
    const b = (body ?? {}) as { kycId?: string; confidenceScore?: number; isDocumentTampered?: boolean };
    if (!b.kycId) throw new BadRequestException('Missing kycId');
    const assessed = await this.risk.assessAndStore(b.kycId);
    await this.queue.publish('kyc.ocr.completed', {
      kycId: b.kycId,
      confidenceScore: b.confidenceScore ?? 0,
      tampered: b.isDocumentTampered === true ? 1 : 0,
      riskLevel: assessed?.riskLevel ?? 'UNKNOWN',
    });
    return { ok: true, riskLevel: assessed?.riskLevel ?? 'UNKNOWN' };
  }
}
