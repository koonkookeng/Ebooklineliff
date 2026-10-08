// SSOT Phase 071 §5/§10 — Tenant identifier lookup (Redis edge-first)
// Canonical: apps/backend/src/modules/tenant/tenant-resolver.service.ts
// - Resolves Edge `x-tenant-identifier` values (slug | `custom:<host>` |
//   `default`) to canonical { tenantId, status } via Redis in <1ms on hit
//   (§1.1), Prisma fallback with cache refill on miss (self-heal §10).
// - getBrandingConfig serves the §3.2 getTenantBranding intent (SSOT
//   TenantBranding shape; hub `default` synthesizes central-hub defaults so
//   the LIFF shell never 404s its own shell).
// - Port-based ctor (tables/cache) keeps contract tests DB-free; NestJS wires
//   PrismaService + RedisClusterService (both @Global via InfraModule).
// - Zero new deps.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  DEFAULT_TENANT_SLUG,
  TENANT_DOMAIN_TTL_SEC,
  TENANT_STATUS_TTL_SEC,
  customDomainOf,
  isCustomDomainIdentifier,
  tenantDomainKey,
  tenantSlugKey,
  tenantStatusKey,
  type TenantEngineBranding,
} from '@repo/shared';

export interface TenantResolutionResult {
  tenantId: string;
  slug: string | null;
  isCustomDomain: boolean;
  isDefault: boolean;
  status: string;
}

export interface TenantResolverTables {
  tenant: {
    findUnique(args: { where: { slug: string } }): Promise<{ id: string; slug: string; name: string; status: string } | null>;
    findById(id: string): Promise<{ id: string; slug: string; name: string; status: string } | null>;
  };
  tenantDomain: {
    findUnique(args: { where: { domainName: string } }): Promise<{ tenantId: string; isVerified: boolean } | null>;
  };
  tenantBrandingConfig: {
    findUnique(args: { where: { tenantId: string } }): Promise<{
      tenantId: string; primaryColor: string; secondaryColor: string; accentColor: string;
      logoUrl: string; faviconUrl: string | null; customFontUrl: string | null;
    } | null>;
  };
}

export interface TenantResolverCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
}

/** Synthetic central-hub branding (valid SSOT uuid = nil UUID). */
export const HUB_BRANDING: TenantEngineBranding = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  tenantSlug: DEFAULT_TENANT_SLUG,
  brandName: 'Ebook LIFF',
  logoUrl: 'https://cdn.omnichannel.com/logo.svg',
  primaryColor: '#16a34a',
  secondaryColor: '#ffffff',
  accentColor: '#10b981',
};

@Injectable()
export class TenantResolverService {
  private readonly logger = new Logger(TenantResolverService.name);

  constructor(
    private readonly tables: TenantResolverTables,
    private readonly cache: TenantResolverCache,
  ) {}

  /** NestJS factory shorthand (keeps module wiring one line). */
  static withInfra(prisma: PrismaService, redis: RedisClusterService): TenantResolverService {
    return new TenantResolverService(
      {
        tenant: {
          findUnique: ({ where }) =>
            (prisma as unknown as TenantResolverTables).tenant.findUnique({ where }),
          findById: (id: string) =>
            (prisma as unknown as { tenant: { findUnique(a: unknown): Promise<{ id: string; slug: string; name: string; status: string } | null> } }).tenant.findUnique({ where: { id } }),
        },
        tenantDomain: {
          findUnique: ({ where }) =>
            (prisma as unknown as TenantResolverTables).tenantDomain.findUnique({ where }),
        },
        tenantBrandingConfig: {
          findUnique: ({ where }) =>
            (prisma as unknown as TenantResolverTables).tenantBrandingConfig.findUnique({ where }),
        },
      },
      redis,
    );
  }

  /** Resolve an edge identifier to its canonical tenant (Redis-first). */
  async resolveTenantIdentifier(identifier: string): Promise<TenantResolutionResult> {
    const id = (identifier ?? '').trim().toLowerCase() || DEFAULT_TENANT_SLUG;
    if (id === DEFAULT_TENANT_SLUG) {
      return { tenantId: DEFAULT_TENANT_SLUG, slug: DEFAULT_TENANT_SLUG, isCustomDomain: false, isDefault: true, status: 'ACTIVE' };
    }
    if (isCustomDomainIdentifier(id)) {
      const host = customDomainOf(id) ?? '';
      const cached = await this.safeGet(tenantDomainKey(host));
      if (cached) {
        return { tenantId: cached, slug: null, isCustomDomain: true, isDefault: false, status: await this.getStatus(cached) };
      }
      const row = await this.tables.tenantDomain.findUnique({ where: { domainName: host } });
      if (!row?.isVerified) throw new NotFoundException(`Unknown custom domain '${host}'.`);
      await this.safeSet(tenantDomainKey(host), TENANT_DOMAIN_TTL_SEC, row.tenantId);
      return { tenantId: row.tenantId, slug: null, isCustomDomain: true, isDefault: false, status: await this.getStatus(row.tenantId) };
    }
    const cached = await this.safeGet(tenantSlugKey(id));
    if (cached) {
      return { tenantId: cached, slug: id, isCustomDomain: false, isDefault: false, status: await this.getStatus(cached) };
    }
    const row = await this.tables.tenant.findUnique({ where: { slug: id } });
    if (!row) throw new NotFoundException(`Unknown tenant '${id}'.`);
    await this.safeSet(tenantSlugKey(id), TENANT_STATUS_TTL_SEC, row.id);
    return { tenantId: row.id, slug: row.slug, isCustomDomain: false, isDefault: false, status: await this.getStatus(row.id, row.status) };
  }

  /** ACTIVE status via Redis edge key, Prisma fallback + refill (fail-closed: UNKNOWN). */
  async getStatus(tenantId: string, knownDbStatus?: string): Promise<string> {
    const cached = await this.safeGet(tenantStatusKey(tenantId));
    if (cached) return cached;
    if (knownDbStatus) {
      await this.safeSet(tenantStatusKey(tenantId), TENANT_STATUS_TTL_SEC, knownDbStatus);
      return knownDbStatus;
    }
    try {
      const row = await this.tables.tenant.findUnique({ where: { slug: tenantId } }).catch(() => null);
      const status = (row as { status?: string } | null)?.status ?? 'UNKNOWN';
      if (status !== 'UNKNOWN') await this.safeSet(tenantStatusKey(tenantId), TENANT_STATUS_TTL_SEC, status);
      return status;
    } catch {
      return 'UNKNOWN';
    }
  }

  /** §3.2 intent: branding config for client hydration (hub synthesizes defaults). */
  async getBrandingConfig(tenantId: string): Promise<TenantEngineBranding> {
    if (tenantId === DEFAULT_TENANT_SLUG) return HUB_BRANDING;
    const row = await this.tables.tenantBrandingConfig.findUnique({ where: { tenantId } });
    if (!row) throw new NotFoundException(`Branding for tenant '${tenantId}' not found.`);
    const tenant = await this.tables.tenant.findById(tenantId).catch(() => null);
    return {
      tenantId: row.tenantId,
      tenantSlug: tenant?.slug ?? 'unknown',
      brandName: tenant?.name ?? 'Tenant Store',
      logoUrl: row.logoUrl,
      ...(row.faviconUrl ? { faviconUrl: row.faviconUrl } : {}),
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      accentColor: row.accentColor,
      ...(row.customFontUrl ? { customFontUrl: row.customFontUrl } : {}),
    };
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return await this.cache.get(key);
    } catch (e) {
      this.logger.warn(`Tenant edge-cache miss (get ${key}): ${(e as Error).message}`);
      return null;
    }
  }

  private async safeSet(key: string, ttl: number, value: string): Promise<void> {
    try {
      await this.cache.setex(key, ttl, value);
    } catch (e) {
      this.logger.warn(`Tenant edge-cache refill skipped (${key}): ${(e as Error).message}`);
    }
  }
}
