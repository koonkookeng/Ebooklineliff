// SSOT Phase 004 Task 004.7 — LINE messaging signature guard (channel secret HMAC)
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';

@Injectable()
export class LineSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature: string | undefined = request.headers['x-line-signature'];
    const secret = process.env.LINE_CHANNEL_SECRET;

    if (!signature || !secret) {
      throw new UnauthorizedException('Missing LINE Signature or Channel Secret');
    }

    const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    const computed = crypto.createHmac('sha256', secret).update(body).digest('base64');

    if (signature.length !== computed.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
      throw new UnauthorizedException('Invalid LINE Signature');
    }
    return true;
  }
}
