// SSOT Phase 072 §5.2 — Company theme resolution + Redis edge cache (<5ms)
// Canonical: apps/backend/src/modules/tenant/company-theme.service.ts
// - getThemeBySlug: Redis `tenant:company-theme:{slug}` hit (<5ms BDD) ->
//   Prisma Tenant+CompanyTheme -> WCAG auto-correction (BDD Scenario 2) ->
//   sanitized cache refill. Unknown slug -> 404 (THEME_ERROR -> hub fallback).
// - updateCompanyTheme: Zod-gated partial -> atomic upsert (slug-keyed, Gate 7)
//   -> cache invalidation -> corrected payload (Gate 8 telemetry via logger).
// - Port-based ctor (tables/cache) keeps contract tests DB-free; NestJS wires
//   PrismaService + RedisClusterService (both @Global via InfraModule).
// - Reuses shared withCompliantText (single WCAG engine, Zero Redundant).
// - Zero new deps.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  COMPANY_THEME_TTL_SEC,
  CompanyThemeConfigSchema,
  UpdateCompanyThemeInputSchema,
  companyThemeKey,
  withCompliantText,
  type CompanyThemeConfig,
  type UpdateCompanyThemeInput,
} from '@repo/shared';

export interface CompanyThemeRow {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  borderRadiusRem: number;
  primaryLogoUrl: string;
  squareLogoUrl: string | null;
  faviconUrl: string | null;
  watermarkLogoUrl: string | null;
  fontFamily: string;
  fontUrl: string | null;
  isAccessibilityValid: boolean;
  updatedAt: Date;
}

export interface CompanyThemeTables {
  tenant: {
    findBySlugWithTheme(slug: string): Promise<{
      id: string; slug: string; name: string; isActive: boolean; theme: CompanyThemeRow | null;
    } | null>;
    findSlugById(id: string): Promise<string | null>;
  };
  companyTheme: {
    upsertByTenant(tenantId: string, data: Record<string, string | number | boolean>): Promise<CompanyThemeRow>;
  };
}

export interface CompanyThemeCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

@Injectable()
export class CompanyThemeService {
  private readonly logger = new Logger(CompanyThemeService.name);

  constructor(
    private readonly tables: CompanyThemeTables,
    private readonly cache: CompanyThemeCache,
  ) {}

  /** NestJS factory shorthand (keeps module wiring one line). */
  static withInfra(prisma: PrismaService, redis: RedisClusterService): CompanyThemeService {
    const tables: CompanyThemeTables = {
      tenant: {
        findBySlugWithTheme: (slug: string) =>
          (prisma as unknown as {
            tenant: { findUnique(a: unknown): Promise<{ id: string; slug: string; name: string; isActive: boolean; themeConfig: CompanyThemeRow | null } | null> };
          }).tenant
            .findUnique({ where: { slug }, include: { themeConfig: true } })
            .then((t) => (t ? { id: t.id, slug: t.slug, name: t.name, isActive: t.isActive, theme: t.themeConfig } : null))
            .catch(() => null),
        findSlugById: (id: string) =>
          (prisma as unknown as {
            tenant: { findUnique(a: unknown): Promise<{ slug: string } | null> };
          }).tenant
            .findUnique({ where: { id } })
            .then((t) => t?.slug ?? null)
            .catch(() => null),
      },
      companyTheme: {
        upsertByTenant: (tenantId: string, data: Record<string, string | number | boolean>) =>
          (prisma as unknown as {
            companyTheme: { upsert(a: unknown): Promise<CompanyThemeRow> };
          }).companyTheme.upsert({ where: { tenantId }, update: { ...data }, create: { tenantId, ...data } }),
      },
    };
    return new CompanyThemeService(tables, redis);
  }

  /** THEME_RESOLVED: edge-first company theme (<5ms on hit, sanitized). */
  async getThemeBySlug(slug: string): Promise<CompanyThemeConfig> {
    const key = (slug ?? '').trim().toLowerCase();
    if (!key) throw new BadRequestException('Missing tenant slug');
    const t0 = Date.now();
    const cached = await this.safeGet(companyThemeKey(key));
    if (cached) {
      try {
        const hit = CompanyThemeConfigSchema.safeParse(JSON.parse(cached) as unknown);
        if (hit.success) return hit.data;
      } catch {
        // Unparseable payload: fall through to DB refill below.
      }
      this.logger.warn(`Corrupt company-theme cache rebuilt: ${companyThemeKey(key)}`);
    }
    const tenant = await this.tables.tenant.findBySlugWithTheme(key);
    if (!tenant?.isActive || !tenant.theme) {
      throw new NotFoundException(`Tenant configuration for '${key}' not found.`);
    }
    const payload = withCompliantText(this.toConfig(tenant.id, tenant.name, tenant.theme));
    await this.safeSet(companyThemeKey(key), COMPANY_THEME_TTL_SEC, JSON.stringify(payload));
    this.logger.log(`company-theme resolve slug=${key} ms=${Date.now() - t0}`);
    return payload;
  }

  /** Admin update: Zod gate -> atomic upsert -> invalidate -> corrected read. */
  async updateCompanyTheme(input: unknown): Promise<CompanyThemeConfig> {
    const parsed = UpdateCompanyThemeInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid company theme input');
    const data = this.toRowPatch(parsed.data);
    const row = await this.tables.companyTheme.upsertByTenant(parsed.data.tenantId, data);
    // Gate 7: invalidate the slug entry (reads are slug-keyed).
    const slug = await this.tables.tenant.findSlugById(parsed.data.tenantId).catch(() => null);
    if (slug) await this.safeDel(companyThemeKey(slug));
    return withCompliantText(this.toConfig(parsed.data.tenantId, 'Tenant Store', row));
  }

  /** Invalidate a slug entry after admin update (Gate 7). */
  async invalidateTenantCache(slug: string): Promise<void> {
    await this.safeDel(companyThemeKey((slug ?? '').trim().toLowerCase()));
  }

  private toConfig(tenantId: string, companyName: string, row: CompanyThemeRow): CompanyThemeConfig {
    return {
      tenantId,
      companyName,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      accentColor: row.accentColor,
      backgroundColor: row.backgroundColor,
      textColor: row.textColor,
      borderRadiusRem: row.borderRadiusRem,
      logoConfig: {
        primaryLogoUrl: row.primaryLogoUrl,
        ...(row.squareLogoUrl ? { squareLogoUrl: row.squareLogoUrl } : {}),
        ...(row.faviconUrl ? { faviconUrl: row.faviconUrl } : {}),
        ...(row.watermarkLogoUrl ? { watermarkLogoUrl: row.watermarkLogoUrl } : {}),
        widthPx: 180,
        heightPx: 50,
      },
      typography: {
        fontFamily: row.fontFamily,
        ...(row.fontUrl ? { fontUrl: row.fontUrl } : {}),
        baseFontSizePx: 16,
        headingWeight: '700',
      },
      isAccessibilityCompliant: row.isAccessibilityValid,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRowPatch(input: UpdateCompanyThemeInput): Record<string, string | number | boolean> {
    const patch: Record<string, string | number | boolean> = {};
    if (input.primaryColor) patch['primaryColor'] = input.primaryColor;
    if (input.secondaryColor) patch['secondaryColor'] = input.secondaryColor;
    if (input.accentColor) patch['accentColor'] = input.accentColor;
    if (input.backgroundColor) patch['backgroundColor'] = input.backgroundColor;
    if (input.textColor) patch['textColor'] = input.textColor;
    if (typeof input.borderRadiusRem === 'number') patch['borderRadiusRem'] = input.borderRadiusRem;
    if (input.logoUrl) patch['primaryLogoUrl'] = input.logoUrl;
    if (input.fontFamily) patch['fontFamily'] = input.fontFamily;
    if (input.fontUrl) patch['fontUrl'] = input.fontUrl;
    return patch;
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return await this.cache.get(key);
    } catch {
      return null;
    }
  }

  private async safeSet(key: string, ttl: number, value: string): Promise<void> {
    try {
      await this.cache.setex(key, ttl, value);
    } catch (e) {
      this.logger.warn(`company-theme refill skipped (${key}): ${(e as Error).message}`);
    }
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch (e) {
      this.logger.warn(`company-theme invalidate skipped (${key}): ${(e as Error).message}`);
    }
  }
}
