// SSOT Phase 111 §3.2/§5.1 — KYC queue review REST (admin workspace)
// Canonical: apps/backend/src/modules/kyc/controllers/kyc-queue.controller.ts
// - GET queue (status/risk/page/limit, masked PII, 300s doc URLs) /
//   POST review (VERIFIED→SELLER atomic / REJECTED with reason, audited).
// - Admin roles only. Zero new deps.
import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { KycQueueReviewService } from '../services/kyc-queue-review.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function adminOf(req: LooseReq): { id: string; role: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('KYC review requires an admin role');
  }
  return { id: user.id, role: user.role };
}

function netOf(req: LooseReq): { ipAddress: string; userAgent: string; tenantName: string } {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    userAgent: headers['user-agent'] ?? 'unknown',
    tenantName: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default',
  };
}

@Controller('api/v1/admin/kyc111')
export class KycQueueController {
  constructor(private readonly review: KycQueueReviewService) {}

  @Get('queue')
  @UseGuards(JwtAuthGuard, TenantGuard)
  queue(
    @Req() req: LooseReq,
    @Query('status') status: string | undefined,
    @Query('riskLevel') riskLevel: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const actor = adminOf(req);
    return this.review.getQueue(actor.role, {
      ...(status ? { status } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('review')
  @UseGuards(JwtAuthGuard, TenantGuard)
  decide(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    return this.review.review(actor, body, netOf(req));
  }
}
