// SSOT Phase 068 §3.2 — OfflineLicenseResolver (code-first GQL)
// Canonical: apps/backend/src/modules/offline-license/offline-license.resolver.ts
// (legacy src/backend/modules/offline-license/offline-license.resolver.ts)
// - Queries: getOfflineLicense / getStorageQuotaUsage (aggregate ledger).
// - Mutations: issueOfflineLicense / revokeOfflineLicense.
// - Zero new deps.
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { OfflineLicenseService } from './offline-license.service';

interface LicenseGqlContext {
  req?: { user?: { id?: string } };
}

@Resolver('OfflineLicense')
export class OfflineLicenseResolver {
  constructor(private readonly licenses: OfflineLicenseService) {}

  private userId(ctx: LicenseGqlContext): string {
    const id = ctx?.req?.user?.id;
    if (!id) throw new Error('Missing session identity');
    return id;
  }

  @Query('getOfflineLicense')
  async getOfflineLicense(
    @Args('productId') productId: string,
    @Args('deviceIdHash') deviceIdHash: string,
    @Context() ctx: LicenseGqlContext,
  ) {
    const userId = this.userId(ctx);
    const status = await this.licenses.getLicense(userId, String(productId), String(deviceIdHash));
    return { ...status, productId: String(productId) };
  }

  @Query('getStorageQuotaUsage')
  async getStorageQuotaUsage(@Context() ctx: LicenseGqlContext) {
    const usage = await this.licenses.getQuotaUsage(this.userId(ctx));
    return { usedBytes: usage.usedBytes, availableBytes: 0, itemCount: usage.itemCount };
  }

  @Mutation('issueOfflineLicense')
  async issueOfflineLicense(
    @Args('productId') productId: string,
    @Args('deviceIdHash') deviceIdHash: string,
    @Context() ctx: LicenseGqlContext,
  ) {
    const res = await this.licenses.issueLicense(this.userId(ctx), String(productId), String(deviceIdHash));
    if (!res.ok || !res.payload) throw new Error(res.error ?? 'ISSUE_FAILED');
    return res.payload;
  }

  @Mutation('revokeOfflineLicense')
  async revokeOfflineLicense(@Args('licenseId') licenseId: string, @Context() ctx: LicenseGqlContext) {
    return this.licenses.revokeLicense(this.userId(ctx), String(licenseId));
  }
}
