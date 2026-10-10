// SSOT Phase 112 Task 7 §5.1 — admin moderation review console REST
// Canonical: apps/backend/src/modules/moderation/controllers/moderation-admin.controller.ts
// - GET queue (status/page/limit, latest-flagged first) / POST review
//   (approve→publish globally / reject→stay quarantined, audited via ledger
//   + adminNotes required). Admin roles only. Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ModerationEngineService } from '../services/moderation-engine.service';
import { AppealManagerService } from '../services/appeal-manager.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

function adminOf(req: LooseReq): { id: string; role: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('Moderation review requires an admin role');
  }
  return { id: user.id, role: user.role };
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

@Controller('api/v1/admin/moderation')
export class ModerationAdminController {
  constructor(
    private readonly engine: ModerationEngineService,
    private readonly appeals: AppealManagerService,
  ) {}

  @Get('queue')
  @UseGuards(JwtAuthGuard, TenantGuard)
  queue(
    @Req() req: LooseReq,
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const actor = adminOf(req);
    return this.engine.getQueue(actor.role, {
      ...(status ? { status } : {}),
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('review')
  @UseGuards(JwtAuthGuard, TenantGuard)
  review(@Req() req: LooseReq, @Body() body: unknown) {
    const actor = adminOf(req);
    const b = (body ?? {}) as { productId?: string; approve?: boolean; adminNotes?: string };
    if (!b.productId || typeof b.approve !== 'boolean' || !b.adminNotes) {
      throw new BadRequestException('Missing productId/approve/adminNotes');
    }
    return this.appeals.decideAppeal(actor, { productId: b.productId, approve: b.approve, adminNotes: b.adminNotes }, tenantOf(req));
  }
}
