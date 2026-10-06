// SSOT Phase 025 Task 2 — Resolve-deep-link use-case (thin dispatch over service core)
// Canonical: apps/backend/src/modules/resolver/application/use-cases/resolve-deep-link.usecase.ts
// (legacy src/backend/modules/resolver/application/use-cases/resolve-deep-link.usecase.ts)
// - Defensive boundary: shortCode validated here (fail-fast 400); service owns
//   cache/DB/HMAC/attribution. Requires-auth rule: promotion/affiliate discovery
//   links resolve publicly; content targets defer to the entitlement gatekeeper.
import { BadRequestException, Injectable } from '@nestjs/common';
import { DeepLinkResolverService } from '../services/deep-link-resolver.service';
import { normalizeShortCode } from '../../domain/entities/short-link.entity';
import {
  ShortCodeParamSchema,
  defaultTargetPath,
  type DeepLinkTargetType,
  type ResolveShortCodeResponse,
} from '@repo/shared';

const PUBLIC_TARGETS = new Set(['PROMOTION_CAMPAIGN', 'AFFILIATE_DISCOVERY']);

@Injectable()
export class ResolveDeepLinkUseCase {
  constructor(private readonly resolver: DeepLinkResolverService) {}

  async execute(
    rawCode: string,
    userAgent: string,
    ip: string,
    referer?: string,
  ): Promise<ResolveShortCodeResponse> {
    const parsed = ShortCodeParamSchema.safeParse({ shortCode: rawCode });
    if (!parsed.success) throw new BadRequestException('Invalid short code');
    const shortCode = normalizeShortCode(parsed.data.shortCode);
    const link = await this.resolver.resolveShortCode(shortCode, userAgent, ip, referer);
    const targetUrl =
      link.customPath && link.customPath.startsWith('/')
        ? link.customPath
        : defaultTargetPath(link.targetType as DeepLinkTargetType, link.targetId);
    return {
      success: true as const,
      targetUrl,
      tenantId: link.tenantId,
      targetType: link.targetType as ResolveShortCodeResponse['targetType'],
      targetId: link.targetId,
      ...(link.affiliateCode ? { affiliateCode: link.affiliateCode } : {}),
      ...(link.couponCode ? { couponCode: link.couponCode } : {}),
      customPath: targetUrl,
      requiresAuth: !PUBLIC_TARGETS.has(link.targetType),
    };
  }
}
