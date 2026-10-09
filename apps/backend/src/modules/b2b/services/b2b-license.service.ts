// SSOT Phase 097 BDD-1 — B2B license service (bulk purchase + provisioning)
// Canonical: apps/backend/src/modules/b2b/services/b2b-license.service.ts
// - Zod gate → account upsert (taxId idempotent) → license pool row with
//   human code → onboarding Flex + claim URL → stream (Gate 8).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  B2B_STREAM,
  CORPORATE_DEFAULT_EXPIRY_DAYS,
  CreateCorporateLicenseInputSchema,
  corporateClaimUrl,
  corporateLicenseCode,
  maskTaxId,
  remainingSeats,
} from '@repo/shared';
import type { B2bRepository } from '../repositories/b2b-prisma.repository';
import { buildCorporateOnboardingFlex } from './b2b-flex.builder';

export interface LicenseBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class B2bLicenseService {
  constructor(
    private readonly repo: B2bRepository,
    private readonly bus: LicenseBus,
    private readonly origin: string = process.env['LIFF_ORIGIN'] || 'https://liff.line.me',
  ) {}

  async createLicense(args: {
    input: {
      corporateName: string; taxId: string; contactEmail: string;
      productId: string; totalSeats: number; expiresInDays?: number;
    };
  }): Promise<{ licenseId: string; licenseCode: string; flexMessageJson: string; claimUrl: string; expiresAt: string }> {
    const parsed = CreateCorporateLicenseInputSchema.safeParse(args.input);
    if (!parsed.success) throw new BadRequestException('Invalid corporate license input');
    const now = Date.now();
    const expiresAt = new Date(now + (parsed.data.expiresInDays ?? CORPORATE_DEFAULT_EXPIRY_DAYS) * 86400 * 1000);
    const account = await this.repo.createAccount({
      companyName: parsed.data.corporateName,
      taxId: parsed.data.taxId,
      contactEmail: parsed.data.contactEmail,
    });
    const code = corporateLicenseCode(now);
    const license = await this.repo.createLicense({
      corporateAccountId: account.id,
      productId: parsed.data.productId,
      totalSeats: parsed.data.totalSeats,
      licenseCode: code,
      expiresAt,
    });
    const claimUrl = corporateClaimUrl(this.origin, code);
    const flexMessageJson = JSON.stringify(
      buildCorporateOnboardingFlex({
        companyName: parsed.data.corporateName,
        totalSeats: parsed.data.totalSeats,
        claimUrl,
      }),
    );
    await this.bus
      .xadd(B2B_STREAM, {
        event: 'corporate_license_created',
        licenseId: license.id,
        corporateAccountId: account.id,
        taxIdMasked: maskTaxId(parsed.data.taxId),
        totalSeats: parsed.data.totalSeats,
        at: now,
      })
      .catch(() => undefined);
    return { licenseId: license.id, licenseCode: code, flexMessageJson, claimUrl, expiresAt: expiresAt.toISOString() };
  }

  async licenseInfo(licenseCode: string): Promise<{
    licenseId: string; corporateAccountId: string; companyName: string; productId: string; productTitle: string;
    totalSeats: number; usedSeats: number; remainingSeats: number; status: string;
  }> {
    const row = await this.repo.findLicenseByCode(licenseCode);
    if (!row) throw new NotFoundException('Corporate license not found');
    return {
      licenseId: row.id,
      corporateAccountId: row.corporateAccountId,
      companyName: row.companyName,
      productId: row.productId,
      productTitle: row.productTitle,
      totalSeats: row.totalSeats,
      usedSeats: row.usedSeats,
      remainingSeats: remainingSeats(row.totalSeats, row.usedSeats),
      status: row.status,
    };
  }
}
