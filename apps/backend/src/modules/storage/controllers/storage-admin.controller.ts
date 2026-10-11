// SSOT Phase 123 Task 6 §3.2 — storage admin REST (dashboard lane shell)
// Canonical: apps/backend/src/modules/storage/controllers/storage-admin.controller.ts
// - Thin decorator shell over StorageHandler (+ sweep/sync lanes).
//   JWT + tenant guards with SUPER_ADMIN/FINANCE_ADMIN roles.
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { R2LifecycleService } from '../services/r2-lifecycle.service';
import { StorageBudgetService } from '../services/storage-budget.service';
import {
  StorageHandler,
  type BudgetConfigInput,
  type LifecycleRuleInput,
  type StorageUser,
} from '../services/storage-handler.service';

type LooseReq = Record<string, unknown>;

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

function adminOf(req: LooseReq): StorageUser {
  const user = (req['user'] as StorageUser | undefined) ?? undefined;
  if (!user?.id || !user.role || !ADMIN_ROLES.has(user.role)) {
    throw new ForbiddenException('Storage admin role required');
  }
  return user;
}

@Controller('api/v1/admin/storage')
export class StorageAdminController {
  constructor(
    private readonly lifecycle: R2LifecycleService,
    private readonly budget: StorageBudgetService,
    private readonly handler: StorageHandler,
  ) {}

  @Get('metrics')
  @UseGuards(JwtAuthGuard, TenantGuard)
  metrics(@Req() req: LooseReq, @Query('tenantId') tenantId: string | undefined) {
    const user = adminOf(req);
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.handler.getStorageUsageMetrics(tenantId, user);
  }

  @Get('rules')
  @UseGuards(JwtAuthGuard, TenantGuard)
  rules(@Req() req: LooseReq, @Query('bucketName') bucketName: string | undefined) {
    const user = adminOf(req);
    if (!bucketName) throw new BadRequestException('bucketName required');
    return this.handler.getR2LifecycleRules(bucketName, user);
  }

  @Get('budget')
  @UseGuards(JwtAuthGuard, TenantGuard)
  budgetConfig(@Req() req: LooseReq, @Query('tenantId') tenantId: string | undefined) {
    const user = adminOf(req);
    if (!tenantId) throw new BadRequestException('tenantId required');
    return this.handler.getStorageBudgetConfig(tenantId, user);
  }

  @Post('rules')
  @UseGuards(JwtAuthGuard, TenantGuard)
  updateRules(@Req() req: LooseReq, @Body() body: { bucketName?: string; rules?: LifecycleRuleInput[] }) {
    const user = adminOf(req);
    if (!body?.bucketName) throw new BadRequestException('bucketName required');
    return this.handler.updateR2LifecycleRules(body.bucketName, body.rules ?? [], user);
  }

  @Post('budget')
  @UseGuards(JwtAuthGuard, TenantGuard)
  updateBudget(@Req() req: LooseReq, @Body() body: BudgetConfigInput) {
    const user = adminOf(req);
    return this.handler.updateStorageBudgetConfig(body, user);
  }

  @Post('sweep')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sweep(@Req() req: LooseReq) {
    adminOf(req);
    return this.budget.evaluateAll();
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sync(@Req() req: LooseReq, @Body() body: { bucketName?: string }) {
    adminOf(req);
    if (!body?.bucketName) throw new BadRequestException('bucketName required');
    return this.lifecycle.syncBucketLifecycleRules(body.bucketName).then((ok) => ({ synced: ok }));
  }
}
