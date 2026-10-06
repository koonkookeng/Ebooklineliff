// SSOT Phase 021 — LINE LIFF Auth Controller (REST endpoint for ID token handshake)
// Canonical: apps/backend/src/modules/auth/liff-auth.controller.ts
// (legacy src/backend/modules/auth/liff-auth.controller.ts)
import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { LiffAuthService } from './liff-auth.service';
import { LiffAuthHandshakeSchema, LiffAuthHandshake, LiffAuthResponse } from '@repo/shared';

@Controller('api/v1/auth/liff')
export class LiffAuthController {
  constructor(private readonly liffAuthService: LiffAuthService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyLiffToken(@Body() body: unknown): Promise<LiffAuthResponse> {
    // Validate request body against Zod Contract
    const parseResult = LiffAuthHandshakeSchema.safeParse(body);
    if (!parseResult.success) {
      throw new UnauthorizedException('Invalid LIFF payload format');
    }

    return await this.liffAuthService.processLiffHandshake(parseResult.data);
  }
}