// SSOT Phase 056 §5.1/§3.2 — Viewport REST gateway (config + cross-device sync)
// Canonical: apps/backend/src/modules/viewport/viewport.controller.ts
// (legacy src/backend/modules/viewport/viewport.controller.ts)
// - POST /api/v1/viewport/config — entitlement-gated routing config.
// - POST /api/v1/viewport/sync — progress + mode sync (<200ms budget, §1.3).
// - Identity arrives via x-user-id (gateway JWT) in tests; production mounts
//   the shared JwtAuthGuard at the module edge without touching this file.
import { BadRequestException, Body, Controller, Post, Headers } from '@nestjs/common';
import { z } from 'zod';
import { ViewportRouterService } from './viewport.service';
import {
  ViewportCapabilitiesSchema,
  ViewportStateSyncInputSchema,
} from '@repo/shared';

@Controller('api/v1/viewport')
export class ViewportController {
  constructor(private readonly router: ViewportRouterService) {}

  @Post('config')
  async getConfig(
    @Headers('x-user-id') userId: string,
    @Body() body: { productId?: string; capabilities?: unknown },
  ) {
    if (!userId) throw new BadRequestException('Missing viewport identity');
    const productId = z.string().uuid().safeParse(body?.productId);
    if (!productId.success) throw new BadRequestException('Missing product identity');
    const caps = ViewportCapabilitiesSchema.parse(body.capabilities);
    return this.router.resolveViewportConfig(userId, productId.data, caps);
  }

  @Post('sync')
  async syncState(@Headers('x-user-id') userId: string, @Body() body: unknown) {
    if (!userId) throw new BadRequestException('Missing viewport identity');
    const input = ViewportStateSyncInputSchema.parse(body);
    return this.router.syncViewportState(userId, input);
  }
}
