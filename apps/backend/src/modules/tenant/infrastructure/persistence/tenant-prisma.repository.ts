// SSOT Phase 030 §4.1 — Tenant branding Prisma repository (slug-keyed reads)
// Canonical: apps/backend/src/modules/tenant/infrastructure/persistence/tenant-prisma.repository.ts
// (legacy src/backend/modules/tenant/infrastructure/persistence/tenant-prisma.repository.ts)
// - Reads by tenantSlug (middleware hint vocabulary); upsert keyed by the same
//   @unique slug (atomic, no read-modify-write race, Gate 7).
// - Structural prisma typing (Phase 027/029 precedent) — no model import.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';

export interface TenantBrandingRow {
  tenantSlug: string;
  defaultTitle: string;
  logoUrl: string;
  primaryColor: string;
  navBarBgColor: string;
  navBarTextColor: string;
  iconTheme: string;
  enableCustomCloseButton: boolean;
  enableShareOptionMenu: boolean;
  updatedAt: Date;
}

interface BrandingTable {
  tenantBranding: {
    findUnique: (args: unknown) => Promise<TenantBrandingRow | null>;
    upsert: (args: unknown) => Promise<TenantBrandingRow>;
  };
}

@Injectable()
export class TenantPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get table(): BrandingTable {
    return this.prisma as unknown as BrandingTable;
  }

  findBySlug(tenantSlug: string): Promise<TenantBrandingRow | null> {
    return this.table.tenantBranding.findUnique({ where: { tenantSlug } }).catch(() => null);
  }

  upsertBySlug(row: Omit<TenantBrandingRow, 'updatedAt'>): Promise<TenantBrandingRow> {
    // Update touches ONLY navbar columns (title/logo belong to branding owners);
    // create bootstraps a slug-titled row for first-time tenants.
    return this.table.tenantBranding.upsert({
      where: { tenantSlug: row.tenantSlug },
      update: {
        primaryColor: row.primaryColor,
        navBarBgColor: row.navBarBgColor,
        navBarTextColor: row.navBarTextColor,
        iconTheme: row.iconTheme,
        enableCustomCloseButton: row.enableCustomCloseButton,
        enableShareOptionMenu: row.enableShareOptionMenu,
      },
      create: { ...row },
    });
  }
}
