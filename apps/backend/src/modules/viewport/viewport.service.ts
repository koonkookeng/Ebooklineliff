// SSOT Phase 056 §5.1 — Viewport router service (entitlement + RAM budget + watermark)
// Canonical: apps/backend/src/modules/viewport/viewport.service.ts
// (legacy src/backend/modules/viewport/viewport.service.ts)
// - Verifies entitlement, resolves the LIFF-strict (30MB) vs Web (512MB)
//   memory budget, mints the forensic watermark line, and caches the session
//   in the Redis edge (3600s TTL, fail-open).
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  VIEWPORT_SESSION_TTL_SEC,
  VIEWPORT_WATERMARK_REFRESH_SEC,
  ViewportCapabilitiesSchema,
  ViewportStateSyncInputSchema,
  ramBudgetFor,
  viewportSessionKey,
  watermarkTextFor,
  type ViewportCapabilities,
  type ViewportConfigPayload,
  type ViewportStateSyncInput,
} from '@repo/shared';

export interface ViewportEntitlementPort {
  hasEntitlement(userId: string, productId: string): Promise<boolean>;
}

export interface ViewportUserPort {
  displayNameOf(userId: string): Promise<string>;
}

export interface ViewportSessionCache {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface ViewportSyncStore {
  recordSync(userId: string, input: ViewportStateSyncInput): Promise<void>;
}

export function watermarkSignature(userId: string, productId: string): string {
  return createHash('sha256').update(`${userId}-${productId}`).digest('hex').slice(0, 32);
}

@Injectable()
export class ViewportRouterService {
  constructor(
    private readonly entitlements: ViewportEntitlementPort,
    private readonly users: ViewportUserPort,
    private readonly sessions: ViewportSessionCache,
    private readonly syncStore?: ViewportSyncStore,
  ) {}

  async resolveViewportConfig(
    userId: string,
    productId: string,
    capabilities: ViewportCapabilities,
  ): Promise<ViewportConfigPayload> {
    const caps = ViewportCapabilitiesSchema.parse(capabilities);
    const entitled = await this.entitlements.hasEntitlement(userId, productId).catch(() => false);
    if (!entitled) {
      throw new BadRequestException('User does not possess active entitlement for this content');
    }
    const maxMemoryLimitMB = ramBudgetFor(caps.isLiff);
    const displayName = await this.users.displayNameOf(userId).catch(() => 'User');
    const watermarkText = watermarkTextFor(displayName, userId);
    const payload: ViewportConfigPayload = {
      productId,
      recommendedMode: caps.environment,
      maxMemoryLimitMB,
      watermarkConfig: {
        watermarkText,
        hashSignature: watermarkSignature(userId, productId),
        refreshIntervalSec: VIEWPORT_WATERMARK_REFRESH_SEC,
      },
    };
    await this.sessions
      .set(viewportSessionKey(userId, productId), JSON.stringify({ caps, updatedAt: new Date().toISOString() }), VIEWPORT_SESSION_TTL_SEC)
      .catch(() => undefined);
    return payload;
  }

  async syncViewportState(userId: string, input: ViewportStateSyncInput): Promise<{ ok: true; syncedAt: string }> {
    const parsed = ViewportStateSyncInputSchema.parse(input);
    await this.syncStore?.recordSync(userId, parsed);
    await this.sessions
      .set(viewportSessionKey(userId, parsed.productId), JSON.stringify({ ...parsed, userId, syncedAt: new Date().toISOString() }), VIEWPORT_SESSION_TTL_SEC)
      .catch(() => undefined);
    return { ok: true, syncedAt: new Date().toISOString() };
  }
}
