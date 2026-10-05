// SSOT Phase 004 §8.1 — HMAC-SHA256 webhook signature guard
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';

@Injectable()
export class HmacSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature: string | undefined = request.headers['x-easyslip-signature'];
    const secret = process.env.EASYSLIP_WEBHOOK_SECRET;

    if (!signature || !secret) {
      throw new UnauthorizedException('Missing Webhook Signature or Secret');
    }

    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(request.body))
      .digest('hex');

    if (
      signature.length !== computedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))
    ) {
      throw new UnauthorizedException('Invalid Signature Hash');
    }
    return true;
  }
}
