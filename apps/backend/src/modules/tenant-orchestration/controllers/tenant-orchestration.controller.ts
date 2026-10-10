// SSOT Phase 108 §5.1 — Tenant Orchestration REST Controller
// Canonical: apps/backend/src/modules/tenant-orchestration/controllers/tenant-orchestration.controller.ts
// - Thin intent adapter over TenantProvisioningService (list/detail/status/
//   package) + DomainVerificationService (domains/cache) + quota enforcer.
// - RISK_CALL: no @nestjs/swagger decorators — swagger is NOT installed
//   (zero-new-deps); OpenAPI stays code-first via the GQL SDL contract record.
// - Serializes Decimal/BigInt explicitly (JSON-safe).
// - Zero new deps.
import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantProvisioningService } from '../services/tenant-provisioning.service';
import { DomainVerificationService } from '../services/domain-verification.service';
import { TenantQuotaEnforcerService } from '../services/tenant-quota-enforcer.service';
import {
  CreateTenantDtoSchema,
  UpdateCompanyStatusDtoSchema,
  UpdateTenantPackageDtoSchema,
  AddTenantCustomDomainDtoSchema,
  TenantsListQuerySchema,
} from '../dto/create-tenant.dto';

function serializeTenantRow<T extends {
  maxStorageBytes: bigint | number | string;
  featureFlags: unknown;
  domains?: unknown;
  subscriptions?: Array<{ monthlyFee: unknown } & Record<string, unknown>>;
  _count?: unknown;
}>(row: T) {
  return {
    ...row,
    maxStorageBytes: row.maxStorageBytes.toString(),
    featureFlags: typeof row.featureFlags === 'string' ? row.featureFlags : JSON.stringify(row.featureFlags),
    activeSubscription: row.subscriptions?.[0]
      ? { ...row.subscriptions[0], monthlyFee: Number(row.subscriptions[0].monthlyFee) }
      : null,
  };
}

@Controller('api/v1/super-admin/tenants')
@UseGuards(JwtAuthGuard)
export class TenantOrchestrationController {
  constructor(
    private readonly provisioning: TenantProvisioningService,
    private readonly domainVerifier: DomainVerificationService,
    private readonly quotaEnforcer: TenantQuotaEnforcerService,
  ) {}

  @Get()
  async getTenantsList(@Query() query: Record<string, unknown>) {
    const parsed = TenantsListQuerySchema.safeParse(query);
    if (!parsed.success) {
      const { status, packageTier, search, page, limit } = query as Record<string, string | undefined>;
      return this.list({ status, packageTier, search, page: Number(page ?? 1), limit: Number(limit ?? 20) });
    }
    return this.list(parsed.data);
  }

  private async list(args: { status?: string; packageTier?: string; search?: string; page?: number; limit?: number }) {
    const { items, total, page, limit, totalPages } = await this.provisioning.listTenants(args);
    return {
      items: items.map((t) => ({
        ...serializeTenantRow(t as Parameters<typeof serializeTenantRow>[0]),
        primaryDomain: t.domains[0]?.domain,
        domainCount: t._count.domains,
      })),
      meta: { page, limit, total, totalPages },
    };
  }

  @Get(':tenantId')
  async getTenantDetail(@Param('tenantId') tenantId: string) {
    const tenant = await this.provisioning.getTenantDetail(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      ...tenant,
      maxStorageBytes: tenant.maxStorageBytes.toString(),
      featureFlags: typeof tenant.featureFlags === 'string' ? tenant.featureFlags : JSON.stringify(tenant.featureFlags),
      subscriptions: tenant.subscriptions.map((s) => ({ ...s, monthlyFee: Number(s.monthlyFee) })),
      usageMetrics: tenant.usageMetrics.map((m) => ({ ...m, storageBytesUsed: m.storageBytesUsed.toString() })),
    };
  }

  @Post()
  async createTenant(@Body() dto: unknown) {
    const parsed = CreateTenantDtoSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException('Invalid tenant provisioning payload');
    }
    const created = await this.provisioning.provisionTenantCompany(parsed.data);
    return { ...created, maxStorageBytes: created.maxStorageBytes.toString() };
  }

  @Put(':tenantId/status')
  async updateStatus(@Param('tenantId') tenantId: string, @Body() dto: unknown) {
    const parsed = UpdateCompanyStatusDtoSchema.safeParse({ ...(dto as object), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid tenant status payload');
    return this.provisioning.updateTenantStatus(tenantId, parsed.data.status, parsed.data.reason);
  }

  @Put(':tenantId/package')
  async updatePackage(@Param('tenantId') tenantId: string, @Body() dto: unknown) {
    const parsed = UpdateTenantPackageDtoSchema.safeParse({ ...(dto as object), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid package payload');
    return this.provisioning.updateTenantPackage(tenantId, parsed.data.packageTier);
  }

  @Post(':tenantId/domains')
  async addCustomDomain(@Param('tenantId') tenantId: string, @Body() dto: unknown) {
    const parsed = AddTenantCustomDomainDtoSchema.safeParse({ ...(dto as object), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid domain payload');
    return this.domainVerifier.addCustomDomain(tenantId, parsed.data.domain);
  }

  @Post(':tenantId/domains/:domain/verify')
  async verifyDomain(@Param('tenantId') tenantId: string, @Param('domain') domain: string) {
    return this.domainVerifier.verifyCustomDomainDNS(tenantId, domain);
  }

  @Post(':tenantId/cache/purge')
  @HttpCode(HttpStatus.OK)
  async purgeCache(@Param('tenantId') tenantId: string) {
    return this.domainVerifier.purgeTenantCache(tenantId);
  }

  @Get(':tenantId/quota')
  async getQuotaStatus(@Param('tenantId') tenantId: string) {
    return this.quotaEnforcer.getAllQuotaStatus(tenantId);
  }

  @Get(':tenantId/usage')
  async getUsageHistory(@Param('tenantId') tenantId: string, @Query('days') days?: string) {
    const n = days ? Number(days) : 30;
    return this.quotaEnforcer.getUsageHistory(tenantId, Number.isFinite(n) ? n : 30);
  }
}
