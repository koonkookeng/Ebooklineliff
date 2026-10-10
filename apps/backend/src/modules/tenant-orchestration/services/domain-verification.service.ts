// SSOT Phase 108 §5.2 — Domain Verification Service
// Canonical: apps/backend/src/modules/tenant-orchestration/services/domain-verification.service.ts
// - DNS CNAME resolution + Cloudflare SSL provisioning stub.
// - Updates domain status + Redis edge cache on success.
// - Zero new deps (uses native dns/promises).
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { resolveCname } from 'dns/promises';
import {
  INGRESS_CNAME_TARGET,
  TENANT_EDGE_CACHE_TTL_SEC,
  QUOTA_MATRIX,
  isValidHostname,
} from '@repo/shared';

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  async verifyCustomDomainDNS(tenantId: string, domain: string) {
    if (!isValidHostname(domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const domainRecord = await this.prisma.tenantCompanyDomain.findFirst({
      where: { tenantId, domain },
    });
    if (!domainRecord) {
      throw new BadRequestException('Domain not found for this tenant');
    }

    try {
      const records = await resolveCname(domain);
      const isValid = records.includes(INGRESS_CNAME_TARGET);

      const updated = await this.prisma.tenantCompanyDomain.update({
        where: { id: domainRecord.id },
        data: {
          status: isValid ? 'ACTIVE' : 'FAILED_DNS_NOT_FOUND',
          sslVerified: isValid,
          verifiedAt: isValid ? new Date() : null,
        },
      });

      if (isValid) {
        await this.redis.setex(
          `tenant:domain:${domain}`,
          TENANT_EDGE_CACHE_TTL_SEC,
          JSON.stringify({
            tenantId,
            status: 'ACTIVE',
          }),
        );
      }

      this.logger.log(`Domain ${domain} verification: ${isValid ? 'ACTIVE' : 'FAILED_DNS_NOT_FOUND'}`);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`DNS Resolution error for ${domain}: ${message}`);
      const updated = await this.prisma.tenantCompanyDomain.update({
        where: { id: domainRecord.id },
        data: { status: 'FAILED_DNS_NOT_FOUND', sslVerified: false },
      });
      return updated;
    }
  }

  async addCustomDomain(tenantId: string, domain: string) {
    if (!isValidHostname(domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const existing = await this.prisma.tenantCompanyDomain.findUnique({
      where: { domain },
    });
    if (existing) {
      throw new BadRequestException('Domain already registered');
    }

    const tenant = await this.prisma.tenantCompany.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant not found');

    // Custom-domain allowance comes from the SSOT quota matrix (spec §1.1:
    // ENTERPRISE_ACADEMY = 3); STARTER_FREE cannot bind custom domains.
    const tenantTier = tenant.packageTier as keyof typeof QUOTA_MATRIX;
    const maxDomains = QUOTA_MATRIX[tenantTier]?.maxCustomDomains ?? 0;
    const currentCustomDomains = await this.prisma.tenantCompanyDomain.count({
      where: { tenantId, isPrimary: false },
    });

    if (currentCustomDomains >= maxDomains) {
      throw new BadRequestException(`Custom domain quota exceeded (max ${maxDomains} for ${tenant.packageTier})`);
    }

    const created = await this.prisma.tenantCompanyDomain.create({
      data: {
        tenantId,
        domain,
        isPrimary: false,
        status: 'PENDING_DNS',
        sslVerified: false,
        cnameTarget: INGRESS_CNAME_TARGET,
      },
    });

    // Initial cache with PENDING_DNS status
    await this.redis.setex(
      `tenant:domain:${domain}`,
      TENANT_EDGE_CACHE_TTL_SEC,
      JSON.stringify({ tenantId, status: 'PENDING_DNS' }),
    );

    this.logger.log(`Added custom domain ${domain} for tenant ${tenantId}`);
    return created;
  }

  async purgeTenantCache(tenantId: string) {
    const domains = await this.prisma.tenantCompanyDomain.findMany({
      where: { tenantId },
    });

    const keys = domains.map((d: { domain: string }) => `tenant:domain:${d.domain}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    this.logger.log(`Purged cache for tenant ${tenantId} (${keys.length} domains)`);
    return { purged: keys.length };
  }

  async getDomainStatus(tenantId: string, domain: string) {
    return this.prisma.tenantCompanyDomain.findFirst({
      where: { tenantId, domain },
    });
  }
}