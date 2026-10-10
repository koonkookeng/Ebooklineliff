// SSOT Phase 108 §5.2 — Tenant Provisioning Service
// Canonical: apps/backend/src/modules/tenant-orchestration/services/tenant-provisioning.service.ts
// - Single atomic $transaction: company + default subdomain + custom domains
//   + initial subscription (Gate 7: all-or-nothing).
// - Quota matrix + feature flags from SSOT (@repo/shared). No inline numbers.
// - Redis edge routing tokens (<1ms lookup) with self-healing refill via
//   getTenantDetail (Phase 108 §10 self-healing: DB fallback re-caches).
// - RISK_CALL: TenantCompany.tenantId (Phase 071 link) is optional per schema —
//   provisioning does NOT fabricate shadow Tenant rows.
// - Zero new deps.
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  CreateTenantPayloadSchema,
  UpdateTenantStatusSchema,
  QUOTA_MATRIX,
  DEFAULT_FEATURE_FLAGS,
  INGRESS_CNAME_TARGET,
  TENANT_EDGE_CACHE_TTL_SEC,
  TENANT_LIST_MAX_LIMIT,
  defaultSubdomainFor,
  isValidHostname,
  statusChangeNeedsReason,
  type CreateTenantPayload,
  type PackageTier,
} from '@repo/shared';

export const TENANT_DOMAIN_CACHE_PREFIX = 'tenant:domain:';

export function tenantDomainCacheKey(domain: string): string {
  return `${TENANT_DOMAIN_CACHE_PREFIX}${domain}`;
}

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  // NOTE: prisma/redis are public-readonly: the REST controller and the
  // code-first GQL resolver are thin intent adapters that reuse this
  // service's clients for filtered reads (no duplicated query logic).
  constructor(
    public readonly prisma: PrismaService,
    public readonly redis: RedisClusterService,
  ) {}

  async provisionTenantCompany(input: CreateTenantPayload) {
    const parsed = CreateTenantPayloadSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('Invalid tenant provisioning payload');
    }
    const data = parsed.data;

    const existing = await this.prisma.tenantCompany.findUnique({
      where: { slug: data.slug },
    });
    if (existing) {
      throw new BadRequestException(`Slug '${data.slug}' is already registered.`);
    }

    const quota = QUOTA_MATRIX[data.packageTier];
    const featureFlags = DEFAULT_FEATURE_FLAGS[data.packageTier];
    const defaultSubdomain = defaultSubdomainFor(data.slug);
    const customDomains = (data.customDomains ?? []).filter((d) => isValidHostname(d));

    // Gate 7: company + domains + subscription commit atomically.
    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenantCompany.create({
        data: {
          name: data.companyName,
          slug: data.slug,
          packageTier: data.packageTier,
          contactEmail: data.primaryContactEmail,
          status: 'ACTIVE',
          maxUsers: quota.maxUsers,
          maxStorageBytes: quota.maxStorageBytes,
          maxMonthlyLiffMAU: quota.maxMonthlyLiffMAU,
          featureFlags: JSON.stringify(featureFlags),
        },
      });

      await tx.tenantCompanyDomain.create({
        data: {
          tenantId: created.id,
          domain: defaultSubdomain,
          isPrimary: true,
          status: 'ACTIVE',
          sslVerified: true,
          cnameTarget: INGRESS_CNAME_TARGET,
        },
      });

      for (const domain of customDomains) {
        await tx.tenantCompanyDomain.create({
          data: {
            tenantId: created.id,
            domain,
            isPrimary: false,
            status: 'PENDING_DNS',
            sslVerified: false,
            cnameTarget: INGRESS_CNAME_TARGET,
          },
        });
      }

      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      await tx.tenantSubscription.create({
        data: {
          tenantId: created.id,
          packageTier: data.packageTier,
          monthlyFee: quota.monthlyFee,
          startsAt: now,
          expiresAt,
          isAutoRenew: true,
          paymentStatus: 'PAID',
        },
      });

      return created;
    });

    // Cache routing tokens to Redis Edge Cache (<1ms lookup).
    const edgePayload = JSON.stringify({
      tenantId: company.id,
      status: company.status,
      theme: company.primaryColor,
    });
    await this.redis.setex(
      tenantDomainCacheKey(defaultSubdomain),
      TENANT_EDGE_CACHE_TTL_SEC,
      edgePayload,
    );
    for (const domain of customDomains) {
      await this.redis.setex(
        tenantDomainCacheKey(domain),
        TENANT_EDGE_CACHE_TTL_SEC,
        JSON.stringify({ tenantId: company.id, status: 'PENDING_DNS' }),
      );
    }

    this.logger.log(`Provisioned tenant: ${data.companyName} (${data.slug})`);
    return company;
  }

  async getTenantDetail(tenantId: string) {
    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
      include: {
        domains: true,
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        usageMetrics: { orderBy: { recordedDate: 'desc' }, take: 30 },
      },
    });
    if (!tenant) return null;

    // Self-healing (§10): refill edge routing tokens when cache is cold.
    for (const domain of tenant.domains) {
      const key = tenantDomainCacheKey(domain.domain);
      const cached = await this.redis.get(key).catch(() => null);
      if (!cached && domain.status === 'ACTIVE') {
        await this.redis
          .setex(
            key,
            TENANT_EDGE_CACHE_TTL_SEC,
            JSON.stringify({
              tenantId: tenant.id,
              status: tenant.status,
              theme: tenant.primaryColor,
            }),
          )
          .catch(() => undefined);
      }
    }
    return tenant;
  }

  async listTenants(args: {
    status?: string;
    packageTier?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(TENANT_LIST_MAX_LIMIT, Math.max(1, args.limit ?? 20));
    const where: Record<string, unknown> = {};
    if (args.status) where['status'] = args.status;
    if (args.packageTier) where['packageTier'] = args.packageTier;
    if (args.search) {
      where['OR'] = [
        { name: { contains: args.search, mode: 'insensitive' } },
        { slug: { contains: args.search, mode: 'insensitive' } },
        { contactEmail: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.tenantCompany.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          domains: { where: { isPrimary: true } },
          subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { domains: true } },
        },
      }),
      this.prisma.tenantCompany.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateTenantStatus(tenantId: string, status: string, reason?: string) {
    const parsed = UpdateTenantStatusSchema.safeParse({ tenantId, status, reason });
    if (!parsed.success) {
      throw new BadRequestException('Invalid tenant status payload');
    }
    if (statusChangeNeedsReason(parsed.data.status) && !parsed.data.reason) {
      throw new BadRequestException('A reason is required for suspension/maintenance transitions');
    }
    const company = await this.prisma.tenantCompany.findUnique({ where: { id: tenantId } });
    if (!company) throw new BadRequestException('Tenant not found');

    const updated = await this.prisma.tenantCompany.update({
      where: { id: tenantId },
      data: { status: parsed.data.status },
    });

    // Status flips must propagate to edge routing immediately.
    const domains = await this.prisma.tenantCompanyDomain.findMany({ where: { tenantId } });
    if (domains.length > 0) {
      await this.redis.del(...domains.map((d) => tenantDomainCacheKey(d.domain)));
    }

    this.logger.log(
      `Updated tenant ${tenantId} status to ${parsed.data.status}${parsed.data.reason ? ` (${parsed.data.reason})` : ''}`,
    );
    return updated;
  }

  async updateTenantPackage(tenantId: string, packageTier: PackageTier) {
    const company = await this.prisma.tenantCompany.findUnique({ where: { id: tenantId } });
    if (!company) throw new BadRequestException('Tenant not found');
    if (!QUOTA_MATRIX[packageTier]) throw new BadRequestException('Unknown package tier');

    const quota = QUOTA_MATRIX[packageTier];
    const featureFlags = DEFAULT_FEATURE_FLAGS[packageTier];

    return this.prisma.tenantCompany.update({
      where: { id: tenantId },
      data: {
        packageTier,
        maxUsers: quota.maxUsers,
        maxStorageBytes: quota.maxStorageBytes,
        maxMonthlyLiffMAU: quota.maxMonthlyLiffMAU,
        featureFlags: JSON.stringify(featureFlags),
      },
    });
  }
}
