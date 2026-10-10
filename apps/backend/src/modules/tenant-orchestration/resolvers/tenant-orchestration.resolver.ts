// SSOT Phase 108 §3.2 — Tenant Orchestration GraphQL Resolver (code-first)
// Canonical: apps/backend/src/modules/tenant-orchestration/resolvers/tenant-orchestration.resolver.ts
// - Intent names match spec §3.2 verbatim (getTenantsList / getTenantDetail /
//   verifyDomainStatus / createTenantCompany / updateTenantStatus /
//   updateTenantPackage / addTenantCustomDomain / purgeTenantCache).
// - RISK_CALL: registerEnumType needs runtime TS enums — Zod SSOT stays the
//   validation source; these GQL twins mirror its values 1:1 (asserted in
//   scripts/test-phase108-contracts.ts). Pattern: Phase 009 ProductTypeGql.
// - Decimal/BigInt are mapped to Float/String explicitly (never spread raw).
// - Zero new deps.
import { Resolver, Query, Mutation, Args, Int, Float, ID, ObjectType, Field, InputType, registerEnumType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantProvisioningService } from '../services/tenant-provisioning.service';
import { DomainVerificationService } from '../services/domain-verification.service';
import { TenantQuotaEnforcerService } from '../services/tenant-quota-enforcer.service';
import { CompanyStatusEnum, PackageTierEnum, DomainVerificationStatusEnum } from '@repo/shared';

enum CompanyStatusGql {
  PENDING_KYC = 'PENDING_KYC',
  TRIAL_ACTIVE = 'TRIAL_ACTIVE',
  TRIAL_EXPIRED = 'TRIAL_EXPIRED',
  ACTIVE = 'ACTIVE',
  SUSPENDED_PAYMENT_OVERDUE = 'SUSPENDED_PAYMENT_OVERDUE',
  SUSPENDED_POLICY_VIOLATION = 'SUSPENDED_POLICY_VIOLATION',
  MAINTENANCE = 'MAINTENANCE',
}
registerEnumType(CompanyStatusGql, { name: 'CompanyStatusEnum' });

enum PackageTierGql {
  STARTER_FREE = 'STARTER_FREE',
  PRO_CREATOR = 'PRO_CREATOR',
  ENTERPRISE_ACADEMY = 'ENTERPRISE_ACADEMY',
  CUSTOM_WHITE_LABEL = 'CUSTOM_WHITE_LABEL',
}
registerEnumType(PackageTierGql, { name: 'PackageTierEnum' });

enum DomainVerificationStatusGql {
  PENDING_DNS = 'PENDING_DNS',
  PROVISIONING_SSL = 'PROVISIONING_SSL',
  ACTIVE = 'ACTIVE',
  FAILED_DNS_NOT_FOUND = 'FAILED_DNS_NOT_FOUND',
  EXPIRED = 'EXPIRED',
}
registerEnumType(DomainVerificationStatusGql, { name: 'DomainVerificationStatusEnum' });

// Keep GQL twins byte-identical to the Zod SSOT (checked at module load).
for (const v of CompanyStatusEnum.options) {
  if ((CompanyStatusGql as Record<string, string>)[v] !== v) throw new Error(`CompanyStatusGql drift: ${v}`);
}
for (const v of PackageTierEnum.options) {
  if ((PackageTierGql as Record<string, string>)[v] !== v) throw new Error(`PackageTierGql drift: ${v}`);
}
for (const v of DomainVerificationStatusEnum.options) {
  if ((DomainVerificationStatusGql as Record<string, string>)[v] !== v) throw new Error(`DomainVerificationStatusGql drift: ${v}`);
}

@InputType()
class CreateTenantInput {
  @Field() companyName!: string;
  @Field() slug!: string;
  @Field(() => PackageTierGql) packageTier!: PackageTierGql;
  @Field() primaryContactEmail!: string;
  @Field(() => [String], { nullable: true }) customDomains?: string[];
}

@InputType()
class UpdateCompanyStatusInput {
  @Field(() => ID) tenantId!: string;
  @Field(() => CompanyStatusGql) status!: CompanyStatusGql;
  @Field({ nullable: true }) reason?: string;
}

@InputType()
class UpdateTenantPackageInput {
  @Field(() => ID) tenantId!: string;
  @Field(() => PackageTierGql) packageTier!: PackageTierGql;
}

@InputType()
class AddTenantCustomDomainInput {
  @Field(() => ID) tenantId!: string;
  @Field() domain!: string;
}

@ObjectType()
class TenantDomainPayload {
  @Field(() => ID) id!: string;
  @Field() domain!: string;
  @Field() isPrimary!: boolean;
  @Field(() => DomainVerificationStatusGql) status!: DomainVerificationStatusGql;
  @Field() sslVerified!: boolean;
  @Field({ nullable: true }) cnameTarget?: string;
  @Field({ nullable: true }) verifiedAt?: Date;
}

@ObjectType()
class TenantSubscriptionPayload {
  @Field(() => ID) id!: string;
  @Field(() => PackageTierGql) packageTier!: PackageTierGql;
  @Field(() => Float) monthlyFee!: number;
  @Field() startsAt!: Date;
  @Field() expiresAt!: Date;
  @Field() isAutoRenew!: boolean;
  @Field() paymentStatus!: string;
}

@ObjectType()
class TenantUsageMetricPayload {
  @Field() recordedDate!: Date;
  @Field(() => Int) activeUsersCount!: number;
  @Field() storageBytesUsed!: string;
  @Field(() => Int) apiCallsCount!: number;
  @Field(() => Int) liffSessionsCount!: number;
}

@ObjectType()
class TenantCompanyPayload {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() slug!: string;
  @Field(() => CompanyStatusGql) status!: CompanyStatusGql;
  @Field(() => PackageTierGql) packageTier!: PackageTierGql;
  @Field() contactEmail!: string;
  @Field({ nullable: true }) contactPhone?: string;
  @Field({ nullable: true }) logoUrl?: string;
  @Field() primaryColor!: string;
  @Field(() => Int) maxUsers!: number;
  @Field() maxStorageBytes!: string;
  @Field(() => Int) maxMonthlyLiffMAU!: number;
  @Field() featureFlags!: string;
  @Field(() => [TenantDomainPayload]) domains!: TenantDomainPayload[];
  @Field(() => TenantSubscriptionPayload, { nullable: true }) activeSubscription?: TenantSubscriptionPayload | null;
  @Field(() => [TenantUsageMetricPayload]) usageMetrics!: TenantUsageMetricPayload[];
  @Field() createdAt!: Date;
  @Field() updatedAt!: Date;
}

@ObjectType()
class TenantConnection {
  @Field(() => [TenantCompanyPayload]) items!: TenantCompanyPayload[];
  @Field(() => Int) total!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) limit!: number;
  @Field(() => Int) totalPages!: number;
}

@ObjectType()
class QuotaStatusPayload {
  @Field() allowed!: boolean;
  @Field(() => Int) current!: number;
  @Field(() => Int) max!: number;
  @Field(() => Float) percentage!: number;
  @Field() warning!: boolean;
}

@ObjectType()
class AllQuotaStatusPayload {
  @Field(() => QuotaStatusPayload) users!: QuotaStatusPayload;
  @Field(() => QuotaStatusPayload) storage!: QuotaStatusPayload;
  @Field(() => QuotaStatusPayload) mau!: QuotaStatusPayload;
}

@ObjectType()
class DomainVerificationPayload {
  @Field(() => ID) id!: string;
  @Field() domain!: string;
  @Field(() => DomainVerificationStatusGql) status!: DomainVerificationStatusGql;
  @Field() sslVerified!: boolean;
  @Field({ nullable: true }) verifiedAt?: Date;
}

@ObjectType()
class CachePurgePayload {
  @Field(() => Int) purged!: number;
}

interface DomainRow {
  id: string;
  domain: string;
  isPrimary: boolean;
  status: string;
  sslVerified: boolean;
  cnameTarget: string;
  verifiedAt: Date | null;
}

interface SubscriptionRow {
  id: string;
  packageTier: string;
  monthlyFee: unknown;
  startsAt: Date;
  expiresAt: Date;
  isAutoRenew: boolean;
  paymentStatus: string;
}

function toDomainPayload(d: DomainRow): TenantDomainPayload {
  return {
    id: d.id,
    domain: d.domain,
    isPrimary: d.isPrimary,
    status: d.status as DomainVerificationStatusGql,
    sslVerified: d.sslVerified,
    cnameTarget: d.cnameTarget,
    verifiedAt: d.verifiedAt ?? undefined,
  };
}

function toSubscriptionPayload(s: SubscriptionRow): TenantSubscriptionPayload {
  return {
    id: s.id,
    packageTier: s.packageTier as PackageTierGql,
    monthlyFee: Number(s.monthlyFee),
    startsAt: s.startsAt,
    expiresAt: s.expiresAt,
    isAutoRenew: s.isAutoRenew,
    paymentStatus: s.paymentStatus,
  };
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class TenantOrchestrationResolver {
  constructor(
    private readonly provisioning: TenantProvisioningService,
    private readonly domainVerifier: DomainVerificationService,
    private readonly quotaEnforcer: TenantQuotaEnforcerService,
  ) {}

  @Query(() => TenantConnection)
  async getTenantsList(
    @Args('status', { nullable: true }) status?: CompanyStatusGql,
    @Args('packageTier', { nullable: true }) packageTier?: PackageTierGql,
    @Args('search', { nullable: true }) search?: string,
    @Args('page', { type: () => Int, nullable: true }) page = 1,
    @Args('limit', { type: () => Int, nullable: true }) limit = 20,
  ): Promise<TenantConnection> {
    const { items, total, totalPages } = await this.provisioning.listTenants({
      status,
      packageTier,
      search,
      page,
      limit,
    });
    return {
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status as CompanyStatusGql,
        packageTier: t.packageTier as PackageTierGql,
        contactEmail: t.contactEmail,
        contactPhone: t.contactPhone ?? undefined,
        logoUrl: t.logoUrl ?? undefined,
        primaryColor: t.primaryColor,
        maxUsers: t.maxUsers,
        maxStorageBytes: t.maxStorageBytes.toString(),
        maxMonthlyLiffMAU: t.maxMonthlyLiffMAU,
        featureFlags: typeof t.featureFlags === 'string' ? t.featureFlags : JSON.stringify(t.featureFlags),
        domains: t.domains.map(toDomainPayload),
        activeSubscription: t.subscriptions[0] ? toSubscriptionPayload(t.subscriptions[0] as SubscriptionRow) : null,
        usageMetrics: [],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      total,
      page,
      limit: Math.min(limit, 100),
      totalPages,
    };
  }

  @Query(() => TenantCompanyPayload)
  async getTenantDetail(@Args('tenantId', { type: () => ID }) tenantId: string) {
    const tenant = await this.provisioning.getTenantDetail(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status as CompanyStatusGql,
      packageTier: tenant.packageTier as PackageTierGql,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone ?? undefined,
      logoUrl: tenant.logoUrl ?? undefined,
      primaryColor: tenant.primaryColor,
      maxUsers: tenant.maxUsers,
      maxStorageBytes: tenant.maxStorageBytes.toString(),
      maxMonthlyLiffMAU: tenant.maxMonthlyLiffMAU,
      featureFlags: typeof tenant.featureFlags === 'string' ? tenant.featureFlags : JSON.stringify(tenant.featureFlags),
      domains: tenant.domains.map(toDomainPayload),
      activeSubscription: tenant.subscriptions[0] ? toSubscriptionPayload(tenant.subscriptions[0] as SubscriptionRow) : null,
      usageMetrics: tenant.usageMetrics.map((m) => ({
        recordedDate: m.recordedDate,
        activeUsersCount: m.activeUsersCount,
        storageBytesUsed: m.storageBytesUsed.toString(),
        apiCallsCount: m.apiCallsCount,
        liffSessionsCount: m.liffSessionsCount,
      })),
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }

  @Query(() => AllQuotaStatusPayload)
  async getTenantQuotaStatus(
    @Args('tenantId', { type: () => ID }) tenantId: string,
  ): Promise<AllQuotaStatusPayload> {
    return this.quotaEnforcer.getAllQuotaStatus(tenantId);
  }

  @Query(() => DomainVerificationPayload)
  async verifyDomainStatus(
    @Args('tenantId', { type: () => ID }) tenantId: string,
    @Args('domain') domain: string,
  ): Promise<DomainVerificationPayload> {
    const result = await this.domainVerifier.getDomainStatus(tenantId, domain);
    if (!result) throw new Error('Domain not found');
    return {
      id: result.id,
      domain: result.domain,
      status: result.status as DomainVerificationStatusGql,
      sslVerified: result.sslVerified,
      verifiedAt: result.verifiedAt ?? undefined,
    };
  }

  @Mutation(() => TenantCompanyPayload)
  async createTenantCompany(@Args('input') input: CreateTenantInput): Promise<TenantCompanyPayload> {
    const tenant = await this.provisioning.provisionTenantCompany({
      companyName: input.companyName,
      slug: input.slug,
      packageTier: input.packageTier as unknown as Parameters<TenantProvisioningService['provisionTenantCompany']>[0]['packageTier'],
      primaryContactEmail: input.primaryContactEmail,
      customDomains: input.customDomains,
    });
    return this.getTenantDetail(tenant.id);
  }

  @Mutation(() => TenantCompanyPayload)
  async updateTenantStatus(@Args('input') input: UpdateCompanyStatusInput): Promise<TenantCompanyPayload> {
    await this.provisioning.updateTenantStatus(input.tenantId, input.status, input.reason);
    return this.getTenantDetail(input.tenantId);
  }

  @Mutation(() => TenantCompanyPayload)
  async updateTenantPackage(@Args('input') input: UpdateTenantPackageInput): Promise<TenantCompanyPayload> {
    await this.provisioning.updateTenantPackage(input.tenantId, input.packageTier as unknown as Parameters<TenantProvisioningService['updateTenantPackage']>[1]);
    return this.getTenantDetail(input.tenantId);
  }

  @Mutation(() => DomainVerificationPayload)
  async addTenantCustomDomain(@Args('input') input: AddTenantCustomDomainInput): Promise<DomainVerificationPayload> {
    const created = await this.domainVerifier.addCustomDomain(input.tenantId, input.domain);
    return {
      id: created.id,
      domain: created.domain,
      status: created.status as DomainVerificationStatusGql,
      sslVerified: created.sslVerified,
      verifiedAt: created.verifiedAt ?? undefined,
    };
  }

  @Mutation(() => CachePurgePayload)
  async purgeTenantCache(@Args('tenantId', { type: () => ID }) tenantId: string): Promise<CachePurgePayload> {
    return this.domainVerifier.purgeTenantCache(tenantId);
  }
}
