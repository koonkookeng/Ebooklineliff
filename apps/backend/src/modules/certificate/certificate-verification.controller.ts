// SSOT Phase 105 Task 4 — Public certificate verification controller (no auth)
// Canonical: apps/backend/src/modules/certificate/certificate-verification.controller.ts
// - GET v1/public/certificates/verify/:certificateNo (?hash=) — fully public
//   (recruiters hold no account). Rate limiting lives in the service.
// - Zero new deps.
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { PublicCertificateVerificationService } from './certificate-verification.service';

interface PublicReq {
  ip?: string;
  headers?: Record<string, string | undefined>;
}

@Controller('v1/public/certificates')
export class PublicCertificateVerificationController {
  constructor(private readonly verifier: PublicCertificateVerificationService) {}

  @Get('verify/:certificateNo')
  verifyPublicCertificate(
    @Param('certificateNo') certificateNo: string,
    @Query('hash') hashSignature: string | undefined,
    @Req() req: PublicReq,
  ) {
    const forwarded = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
    return this.verifier.verifyPublicCertificate({
      certificateNo,
      hashSignature,
      ipAddress: forwarded ?? req.ip ?? '0.0.0.0',
      userAgent: req.headers?.['user-agent'] ?? 'Unknown',
    });
  }
}
