// SSOT Phase 085 — KYC submission REST (self scope + presigned uploads)
// Canonical: apps/backend/src/modules/kyc/controllers/kyc-submission.controller.ts
// (legacy class name KycSubmissionControllerController renamed — no importers.)
// - POST submit (JWT, <3s PENDING path) / GET status / POST presign (R2 PUT).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { KycVerificationService } from '../services/kyc-verification.service';
import { R2PrivateVaultClient } from '../infra/r2-private-vault.client';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function netOf(req: LooseReq): { ipAddress: string; userAgent: string } {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    userAgent: headers['user-agent'] ?? 'unknown',
  };
}

@Controller('api/v1/kyc')
export class KycSubmissionController {
  constructor(
    private readonly kyc: KycVerificationService,
    private readonly vault: R2PrivateVaultClient,
  ) {}

  @Post('submit')
  @UseGuards(JwtAuthGuard, TenantGuard)
  submit(@Req() req: LooseReq, @Body() body: unknown) {
    return this.kyc.submitCreatorKyc(actorOf(req), body, netOf(req));
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, TenantGuard)
  status(@Req() req: LooseReq) {
    return this.kyc.statusOf(actorOf(req));
  }

  @Post('presign')
  @UseGuards(JwtAuthGuard, TenantGuard)
  presign(@Req() req: LooseReq, @Body() body: unknown) {
    const kind = (body as { kind?: string } | null)?.kind;
    if (kind !== 'id-card' && kind !== 'selfie' && kind !== 'bookbank') {
      throw new BadRequestException('Invalid document kind');
    }
    return this.vault.uploadUrl(actorOf(req), kind);
  }

  @Get('view-url')
  @UseGuards(JwtAuthGuard, TenantGuard)
  viewUrl(@Req() req: LooseReq, @Query('key') key: string | undefined) {
    if (!key) throw new BadRequestException('Missing key');
    return this.vault.viewUrl(key);
  }
}
