// SSOT Phase 048 Task 5 — CertificateVerifyController (REST public verification)
// Canonical: apps/backend/src/modules/certificate/presentation/certificate-verify.controller.ts
// (legacy src/backend/modules/certificate/presentation/certificate-verify.controller.ts)
// - GET /api/v1/certificate/verify?certNo= (public, <200ms, rate-limited 20/min)
// - POST /api/v1/certificate/issue (JWT, completion-gated + idempotent)
// - GET /api/v1/certificate/my (JWT, user's ISSUED certificates)
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { GenerateCertificateInputSchema } from '@repo/shared';
import { CertificateVerificationService } from '../application/services/certificate-verification.service';
import { CertificatePdfGeneratorService } from '../application/services/certificate-pdf-generator.service';
import { resolveReaderIdentity } from '../../reader/reader-identity';

interface CertificateReq {
  user?: { id?: string; displayName?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

@Controller('api/v1/certificate')
export class CertificateVerifyController {
  constructor(
    private readonly verifier: CertificateVerificationService,
    private readonly generator: CertificatePdfGeneratorService,
  ) {}

  @Get('verify')
  async verify(@Query('certNo') certNo: string | undefined, @Req() req: CertificateReq) {
    if (!certNo) throw new BadRequestException('Missing certificate number');
    return this.verifier.verifyCertificate({
      certificateNo: certNo,
      clientIp: req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
    });
  }

  @Post('issue')
  @UseGuards(JwtAuthGuard)
  async issue(@Body() body: Record<string, unknown>, @Req() req: CertificateReq) {
    const { userId } = resolveReaderIdentity({ req });
    const parsed = GenerateCertificateInputSchema.safeParse({ ...body, userId });
    if (!parsed.success) throw new BadRequestException('Invalid input');
    return this.generator.generateCertificate(parsed.data);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async myCertificates(@Req() req: CertificateReq) {
    const { userId } = resolveReaderIdentity({ req });
    return this.verifier.getUserCertificates(userId);
  }
}
