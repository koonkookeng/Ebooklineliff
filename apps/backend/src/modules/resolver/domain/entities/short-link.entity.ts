// SSOT Phase 025 §5.1 — Short-link domain entity (invariants, no I/O)
// Canonical: apps/backend/src/modules/resolver/domain/entities/short-link.entity.ts
// (legacy src/backend/modules/resolver/domain/entities/short-link.entity.ts)
// - Pure guards: creation invariants + resolvability (active/expiry/redemption cap).
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CreateShortLinkInputSchema,
  defaultTargetPath,
  type CreateShortLinkInput,
  type DeepLinkTargetType,
} from '@repo/shared';

export interface ShortLinkRecord {
  id: string;
  tenantId: string;
  shortCode: string;
  targetType: DeepLinkTargetType;
  targetId: string;
  customPath: string;
  affiliateCode?: string | null;
  campaignId?: string | null;
  couponCode?: string | null;
  signature: string;
  clickCount: number;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
  isActive: boolean;
}

export function normalizeShortCode(raw: string): string {
  const code = raw.trim();
  if (!/^[A-Za-z0-9-_]{3,50}$/.test(code)) {
    throw new BadRequestException('Invalid short code');
  }
  return code;
}

/** Creation invariants (Zod SSOT + expiry must be future-dated). */
export function assertCreatable(raw: CreateShortLinkInput): CreateShortLinkInput {
  const parsed = CreateShortLinkInputSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Invalid short-link input');
  const input = parsed.data;
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new BadRequestException('expiresAt must be in the future');
  }
  return input;
}

/** Default LIFF path for a target (customPath override lives in the use-case). */
export function buildCustomPath(
  targetType: DeepLinkTargetType,
  targetId: string,
  affiliateCode?: string,
  couponCode?: string,
): string {
  const base = defaultTargetPath(targetType, targetId);
  const params = new URLSearchParams();
  if (affiliateCode) params.set('aff', affiliateCode);
  if (couponCode) params.set('coupon', couponCode);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Resolution guards: active, unexpired, under redemption cap (fail-closed 404). */
export function assertResolvable(link: ShortLinkRecord): ShortLinkRecord {
  if (!link.isActive) throw new NotFoundException('Short code not found or expired.');
  if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
    throw new NotFoundException('Short link has expired.');
  }
  if (
    typeof link.maxRedemptions === 'number' &&
    link.clickCount >= link.maxRedemptions
  ) {
    throw new NotFoundException('Short link redemption limit reached.');
  }
  return link;
}
