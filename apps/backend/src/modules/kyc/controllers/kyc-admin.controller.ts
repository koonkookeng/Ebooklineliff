// SSOT Phase 085 Task 7 — Admin KYC review console (manual override)
// Canonical: apps/backend/src/modules/kyc/controllers/kyc-admin.controller.ts
// (legacy class name KycSubmission…/KycAdminControllerController renamed.)
// - GET queue (PENDING/ACTION_REQUIRED) / POST decide (VERIFIED/REJECTED/
//   ACTION_REQUIRED, audited) / GET view-url (3-min, audited VIEW_SENSITIVE).
// - Admin roles only. Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { KycVerificationService } from '../services/kyc-verification.service';
import { R2PrivateVaultClient } from '../infra/r2-private-vault.client';
import { PrismaKycStore } from '../services/kyc-verification.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function adminOf(req: LooseReq): { id: string; role: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('KYC review requires an admin role');
  }
  return { id: user.id, role: user.role };
}

function netOf(req: LooseReq): { ipAddress: string; userAgent: string } {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    userAgent: headers['user-agent'] ?? 'unknown',
  };
}

@Controller('api/v1/admin/kyc')
export class KycAdminController {
  constructor(
    private readonly kyc: KycVerificationService,
    private readonly vault: R2PrivateVaultClient,
    private readonly store: PrismaKycStore,
  ) {}

  @Get('queue')
  @UseGuards(JwtAuthGuard, TenantGuard)
  queue(@Req() req: LooseReq) {
    adminOf(req);
    return this.store.reviewQueue();
  }

  @Post('decide')
  @UseGuards(JwtAuthGuard, TenantGuard)
  decide(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    const b = (body ?? {}) as { kycId?: string; status?: string; rejectionReason?: string; adminNote?: string };
    if (!b.kycId || !b.status) throw new BadRequestException('Missing kycId/status');
    return this.kyc.decideKyc(actor.id, actor.role, b as { kycId: string; status: string }, netOf(req));
  }

  @Get('view-url')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async viewUrl(@Req() req: LooseReq, @Query('kycId') kycId: string | undefined, @Query('key') key: string | undefined) {
    const actor = adminOf(req);
    if (!kycId || !key) throw new BadRequestException('Missing kycId/key');
    const out = this.vault.viewUrl(key);
    await this.store.audit({
      kycId,
      actorUserId: actor.id,
      action: 'VIEW_SENSITIVE',
      ipAddress: netOf(req).ipAddress,
      userAgent: netOf(req).userAgent,
    });
    return out;
  }
}
