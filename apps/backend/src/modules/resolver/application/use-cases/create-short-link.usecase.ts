// SSOT Phase 025 Task 2 — Create-short-link use-case (fraud-safe HMAC short codes)
// Canonical: apps/backend/src/modules/resolver/application/use-cases/create-short-link.usecase.ts
// (legacy src/backend/modules/resolver/application/use-cases/create-short-link.usecase.ts)
// - Zero new deps (node:crypto random for codes). HMAC signs the canonical payload
//   so URL params can't be tampered (§1.3 Scenario 3, Gate 4).
import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { HmacCryptoService } from '../../domain/services/hmac-crypto.service';
import { assertCreatable, buildCustomPath } from '../../domain/entities/short-link.entity';
import { ShortLinkRepository } from '../../infrastructure/repositories/short-link.repository';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import type { CreateShortLinkInput } from '@repo/shared';

function randomCode(): string {
  return randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9-_]/g, 'X').slice(0, 8);
}

@Injectable()
export class CreateShortLinkUseCase {
  constructor(
    private readonly repo: ShortLinkRepository,
    private readonly crypto: HmacCryptoService,
    private readonly redis: RedisClusterService,
  ) {}

  async execute(raw: CreateShortLinkInput) {
    const input = assertCreatable(raw);
    const shortCode = input.customSlug ?? randomCode();
    const customPath = buildCustomPath(
      input.targetType,
      input.targetId,
      input.affiliateCode,
      input.couponCode,
    );
    const payload = {
      targetType: input.targetType,
      targetId: input.targetId,
      tenantId: input.tenantId,
      ...(input.affiliateCode ? { affiliateCode: input.affiliateCode } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      customPath,
    };
    const signature = this.crypto.generateSignature(payload);
    try {
      const row = await this.repo.create({
        tenantId: input.tenantId,
        shortCode,
        targetType: input.targetType,
        targetId: input.targetId,
        customPath,
        affiliateCode: input.affiliateCode,
        campaignId: input.campaignId,
        couponCode: input.couponCode,
        signature,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      });
      await this.redis
        .setex(`resolver:code:${shortCode}`, 86400, JSON.stringify(row))
        .catch(() => undefined);
      return row;
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Short code already taken.');
      }
      throw err;
    }
  }
}
