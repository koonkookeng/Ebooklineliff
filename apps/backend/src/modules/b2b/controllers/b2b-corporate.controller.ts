// SSOT Phase 097 — B2B corporate REST (HR JWT + invite intake)
// Canonical: apps/backend/src/modules/b2b/controllers/b2b-corporate.controller.ts
// - POST license / POST claim (member JWT) / POST allocate / POST revoke /
//   GET dashboard / GET license-info (public code lookup). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { BulkSeatInviteInputSchema } from '@repo/shared';
import { B2bLicenseService } from '../services/b2b-license.service';
import { B2bSeatAllocationService } from '../services/b2b-seat-allocation.service';
import { B2bAnalyticsService } from '../services/b2b-analytics.service';
import type { B2bRepository } from '../repositories/b2b-prisma.repository';
import { PrismaB2bRepository } from '../repositories/b2b-prisma.repository';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

function lineUserOf(req: LooseReq): string | undefined {
  const user = (req['user'] as { lineUserId?: string } | undefined) ?? {};
  return user.lineUserId;
}

@Controller('api/v1/b2b')
export class B2bCorporateController {
  constructor(
    private readonly licenses: B2bLicenseService,
    private readonly seats: B2bSeatAllocationService,
    private readonly analytics: B2bAnalyticsService,
    private readonly repo: PrismaB2bRepository,
  ) {}

  @Post('license')
  @UseGuards(JwtAuthGuard, TenantGuard)
  createLicense(@Body() body: unknown) {
    return this.licenses.createLicense({ input: (body ?? {}) as never });
  }

  @Get('license-info')
  licenseInfo(@Query('code') code: string | undefined) {
    if (!code) throw new BadRequestException('Missing code');
    return this.licenses.licenseInfo(code);
  }

  @Post('claim')
  @UseGuards(JwtAuthGuard, TenantGuard)
  claim(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { licenseCode?: string };
    if (!b.licenseCode) throw new BadRequestException('Missing licenseCode');
    return this.seats.claimSeatForUser({ licenseCode: b.licenseCode, userId: actorOf(req), lineUserId: lineUserOf(req) });
  }

  @Post('allocate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async allocate(@Body() body: unknown) {
    const b = (body ?? {}) as { licenseId?: string; departmentId?: string; emails?: string[]; lineUserIds?: string[] };
    if (!b.licenseId) throw new BadRequestException('Missing licenseId');
    const parsed = BulkSeatInviteInputSchema.safeParse({
      licenseId: b.licenseId,
      departmentId: b.departmentId,
      emails: b.emails,
      lineUserIds: b.lineUserIds,
    });
    if (!parsed.success) throw new BadRequestException('Invalid invite input');
    const repo: B2bRepository = this.repo;
    const invited = await repo.allocateInvites({
      licenseId: parsed.data.licenseId,
      departmentId: parsed.data.departmentId,
      emails: parsed.data.emails ?? [],
      lineUserIds: parsed.data.lineUserIds ?? [],
    });
    return { invited };
  }

  @Post('revoke')
  @UseGuards(JwtAuthGuard, TenantGuard)
  revoke(@Body() body: unknown) {
    const b = (body ?? {}) as { seatId?: string };
    if (!b.seatId) throw new BadRequestException('Missing seatId');
    return this.seats.revokeSeat({ seatId: b.seatId });
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, TenantGuard)
  dashboard(@Query('corporateAccountId') corporateAccountId: string | undefined) {
    if (!corporateAccountId) throw new BadRequestException('Missing corporateAccountId');
    return this.analytics.dashboard(corporateAccountId);
  }
}
