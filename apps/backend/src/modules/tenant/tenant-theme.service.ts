// SSOT Phase 030 Task 2/§5.2 — Tenant theme service (edge-first + AA guard)
// Canonical: apps/backend/src/modules/tenant/tenant-theme.service.ts
// (legacy src/backend/modules/tenant/tenant-theme.service.ts)
// - getTenantBranding: Redis hit (<50ms BDD) → Prisma row → 404; cached payloads
//   re-validated (corrupt entries self-heal via DB refill); served text color is
//   ALWAYS the contrast-guarded value (readability 100%, BDD Scenario 2).
// - updateNavbarTheme: Zod-gated → contrast verdict → atomic upsert → cache
//   invalidation (Gate 7) → applied-event publish (Gate 8, best-effort).
// - Zero new deps: Prisma repo + Redis cache + contrast calculator only.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  THEME_ANALYTICS_CHANNEL,
  TenantBrandingSchema,
  UpdateNavbarThemeInputSchema,
  type TenantBranding,
  type UpdateNavbarThemeInput,
} from '@repo/shared';
import { ContrastCalculatorService } from './domain/services/contrast-calculator.service';
import { TenantThemeCache } from './infrastructure/cache/tenant-redis.cache';
import { TenantPrismaRepository } from './infrastructure/persistence/tenant-prisma.repository';

@Injectable()
export class TenantThemeService {
  private readonly logger = new Logger(TenantThemeService.name);

  constructor(
    private readonly repo: TenantPrismaRepository,
    private readonly cache: TenantThemeCache,
    private readonly contrast: ContrastCalculatorService,
    private readonly redis: RedisClusterService,
  ) {}

  /** Edge-first brand fetch (<50ms on hit); 404 when the slug is unknown. */
  async getTenantBranding(tenantSlug: string): Promise<TenantBranding> {
    if (!tenantSlug) throw new BadRequestException('Missing tenant slug');
    const cached = await this.cache.get(tenantSlug);
    if (cached) {
      try {
        const hit = TenantBrandingSchema.safeParse(JSON.parse(cached) as unknown);
        if (hit.success) return this.withGuardedText(hit.data);
      } catch {
        // Unparseable payload: fall through to DB refill below.
      }
      this.logger.warn(`Corrupt theme cache entry rebuilt: ${this.cache.key(tenantSlug)}`);
    }
    const row = await this.repo.findBySlug(tenantSlug);
    if (!row) throw new NotFoundException(`Tenant branding for '${tenantSlug}' not found.`);
    const branding: TenantBranding = {
      tenantId: row.tenantSlug,
      brandName: row.defaultTitle,
      ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
      primaryColor: row.primaryColor,
      navBarBgColor: row.navBarBgColor,
      navBarTextColor: row.navBarTextColor,
      iconTheme: (row.iconTheme === 'LIGHT' || row.iconTheme === 'DARK' ? row.iconTheme : 'AUTO') as TenantBranding['iconTheme'],
      enableCustomCloseButton: row.enableCustomCloseButton,
      enableShareOptionMenu: row.enableShareOptionMenu,
      updatedAt: row.updatedAt.toISOString(),
    };
    const guarded = this.withGuardedText(branding);
    await this.cache.set(tenantSlug, JSON.stringify(guarded));
    return guarded;
  }

  /** Admin update: validate → AA-guard → upsert → invalidate → event. */
  async updateNavbarTheme(body: unknown): Promise<boolean> {
    const parsed = UpdateNavbarThemeInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid navbar theme input');
    const input: UpdateNavbarThemeInput = parsed.data;
    const verdict = this.contrast.check(input.navBarBgColor, input.navBarTextColor, input.iconTheme);
    const row = await this.repo.upsertBySlug({
      tenantSlug: input.tenantId,
      defaultTitle: input.tenantId,
      logoUrl: '',
      primaryColor: input.primaryColor,
      navBarBgColor: input.navBarBgColor,
      navBarTextColor: verdict.textColor,
      iconTheme: verdict.iconTheme,
      enableCustomCloseButton: input.enableCustomCloseButton,
      enableShareOptionMenu: input.enableShareOptionMenu,
    });
    await this.cache.del(input.tenantId);
    await this.redis
      .publish(
        THEME_ANALYTICS_CHANNEL,
        JSON.stringify({ event: 'navbar_theme_applied', tenantId: input.tenantId, navBarBgColor: row.navBarBgColor, latencyMs: 0 }),
      )
      .catch((err: unknown) => {
        this.logger.warn(`Theme event publish failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    return true;
  }

  /** Enforce guarded text/icon on any served payload (cache or DB origin). */
  private withGuardedText(branding: TenantBranding): TenantBranding {
    const verdict = this.contrast.check(branding.navBarBgColor, branding.navBarTextColor, branding.iconTheme);
    return { ...branding, navBarTextColor: verdict.textColor, iconTheme: verdict.iconTheme };
  }
}
