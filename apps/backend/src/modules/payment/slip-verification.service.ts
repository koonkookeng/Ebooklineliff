// SSOT Phase 014 §5.3 — v1 slip verification facade (base64-or-URL → atomic verify)
// Canonical: apps/backend/src/modules/payment/slip-verification.service.ts
// (legacy src/backend/modules/payment/slip-verification.service.ts)
// Thin orchestration over the order bounded context (upload to R2 when the
// client posts raw base64, then the atomic SlipVerifyService). No duplicated
// verification logic — the response is mapped onto the spec §3.1 shape.
import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  SlipVerificationInputSchema,
  SlipVerificationResponseSchema,
  type SlipVerificationResponse,
} from '@repo/shared';
import { SlipVerifyService } from '../order/services/slip-verify.service';
import { SlipUploadService } from '../order/services/slip-upload.service';

export interface ProcessSlipInput {
  orderId: string;
  slipImageUrl?: string;
  slipBase64?: string;
  filename?: string;
  contentType?: string;
  tenantId: string;
  actorUserId: string;
  slipSha256?: string;
}

@Injectable()
export class SlipVerificationService {
  constructor(
    private readonly uploads: SlipUploadService,
    private readonly verify: SlipVerifyService,
  ) {}

  /** HTTP boundary: auth + Zod input + orchestration (unit-testable; no Nest decorators). */
  async handleVerifyRequest(body: unknown, userId?: string): Promise<SlipVerificationResponse> {
    if (!userId) throw new UnauthorizedException('Unauthorized');
    const parsed = SlipVerificationInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid slip verification payload');
    return this.processSlipVerification({ ...parsed.data, actorUserId: userId });
  }

  /** Validates the v1 input, materializes base64 via R2, then atomic-verifies. */
  async processSlipVerification(raw: ProcessSlipInput): Promise<SlipVerificationResponse> {
    const parsed = SlipVerificationInputSchema.safeParse({
      orderId: raw.orderId,
      slipImageUrl: raw.slipImageUrl,
      slipBase64: raw.slipBase64,
      filename: raw.filename ?? 'slip.png',
      contentType: raw.contentType ?? 'image/png',
      tenantId: raw.tenantId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid slip verification payload');
    const input = parsed.data;

    let slipImageUrl = input.slipImageUrl;
    let slipSha256 = input.slipSha256 ?? raw.slipSha256;
    if (!slipImageUrl && input.slipBase64) {
      const uploaded = await this.uploads.uploadSlipImage(
        input.orderId, input.filename, input.contentType, input.slipBase64,
        { tenantId: input.tenantId },
      );
      slipImageUrl = uploaded.slipImageUrl;
      slipSha256 = uploaded.slipSha256;
    }
    if (!slipImageUrl) throw new BadRequestException('Either slipImageUrl or slipBase64 is required');

    const result = await this.verify.verify(input.orderId, slipImageUrl, raw.actorUserId, { slipSha256 });
    const mapped = {
      success: result.success,
      message: result.message,
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      paymentStatus: result.paymentStatus,
      transRef: result.transRef,
      entitlementGranted: result.entitlementsGranted.length > 0,
      processedInMs: result.processedInMs ?? 0,
    };
    const checked = SlipVerificationResponseSchema.safeParse(mapped);
    if (!checked.success) throw new BadRequestException('Verification response contract drift');
    return checked.data;
  }
}
