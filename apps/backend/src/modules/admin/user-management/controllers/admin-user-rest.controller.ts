// SSOT Phase 109 §5.1 — Admin user REST controller (central console intents)
// Canonical: apps/backend/src/modules/admin/user-management/controllers/admin-user-rest.controller.ts
// - JwtAuthGuard (identity) + AdminRbacGuard (SUPER/FINANCE/SUPPORT; fail-closed).
// - TenantAdmin scoping: non-global roles are pinned to their X-Tenant-ID.
// - Thin intent adapter: Zod gates live in DTO/shared; writes are atomic in
//   the command service (Gate 7).
// - Zero new deps.
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { AdminRbacGuard, RequireAdminRoles } from '../guards/admin-rbac.guard';
import { AdminUserQueryService } from '../services/admin-user-query.service';
import { AdminUserCommandService } from '../services/admin-user-command.service';
import { AdminKycProcessorService } from '../services/admin-kyc-processor.service';
import { AdminUserFilterQuerySchema } from '../dto/admin-user-filter.dto';
import { KycRejectBodySchema, ImpersonateBodySchema, WalletAdjustBodySchema } from '../dto/admin-user-action.dto';

interface AuthedRequest extends Record<string, unknown> {
  user?: { id?: string; sub?: string; role?: string; tenantId?: string; isImpersonated?: boolean };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function adminIdOf(req: AuthedRequest): string {
  const id = req.user?.id ?? req.user?.sub;
  if (!id) throw new BadRequestException('Missing admin identity');
  return id;
}

function clientIpOf(req: AuthedRequest): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.ip as string) ?? 'unknown';
}

/** TenantAdmin sees only their tenant; global admins see all (X-Tenant-ID). */
function tenantScopeOf(req: AuthedRequest): string | undefined {
  if (req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'FINANCE_ADMIN') return undefined;
  return req.headers?.['x-tenant-id'] ?? req.user?.tenantId;
}

@Controller('api/v1/admin/users')
@UseGuards(JwtAuthGuard, AdminRbacGuard)
export class AdminUserRestController {
  constructor(
    private readonly queries: AdminUserQueryService,
    private readonly commands: AdminUserCommandService,
    private readonly kyc: AdminKycProcessorService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() req: AuthedRequest) {
    const parsed = AdminUserFilterQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid admin user filter');
    return this.queries.listUsersAndMerchants(parsed.data, tenantScopeOf(req));
  }

  @Get('kyc/pending')
  async kycPending(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.kyc.getPendingList(Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Get(':userId')
  async detail(@Param('userId') userId: string) {
    return this.queries.getUserDetail(userId);
  }

  @Get(':userId/kyc/documents')
  async kycDocuments(@Param('userId') userId: string, @Req() req: AuthedRequest) {
    return this.kyc.getKycDocumentUrls(adminIdOf(req), userId, clientIpOf(req));
  }

  @Post('actions')
  async executeAction(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.commands.executeAdminUserAction(adminIdOf(req), clientIpOf(req), body, {
      impersonated: req.user?.isImpersonated === true,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post(':userId/kyc/approve')
  @RequireAdminRoles('SUPER_ADMIN', 'SUPPORT_STAFF')
  async approveKyc(@Param('userId') userId: string, @Req() req: AuthedRequest) {
    return this.kyc.approveKYC(adminIdOf(req), userId, clientIpOf(req));
  }

  @Post(':userId/kyc/reject')
  @RequireAdminRoles('SUPER_ADMIN', 'SUPPORT_STAFF')
  async rejectKyc(@Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = KycRejectBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('กรุณาระบุเหตุผลในการปฏิเสธ KYC');
    return this.kyc.rejectKYC(adminIdOf(req), userId, clientIpOf(req), parsed.data.reason);
  }

  @Post(':userId/wallet/adjust')
  @RequireAdminRoles('SUPER_ADMIN', 'FINANCE_ADMIN')
  async adjustWallet(@Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = WalletAdjustBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid wallet adjustment payload');
    return this.commands.executeAdminUserAction(
      adminIdOf(req),
      clientIpOf(req),
      { userId, action: 'ADJUST_WALLET', walletAdjustmentAmount: parsed.data.amount, reason: parsed.data.reason },
      { impersonated: req.user?.isImpersonated === true },
    );
  }

  @Post('impersonate')
  @RequireAdminRoles('SUPER_ADMIN')
  async impersonate(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = ImpersonateBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid impersonation payload');
    return this.commands.mintImpersonationToken(adminIdOf(req), parsed.data.userId, parsed.data.reason, clientIpOf(req));
  }

  @Post('impersonate/resolve')
  @RequireAdminRoles('SUPER_ADMIN')
  async resolveImpersonation(@Body() body: { ticket?: string }) {
    if (!body?.ticket) throw new BadRequestException('Missing ticket');
    return this.commands.resolveImpersonationTicket(body.ticket);
  }
}
