// SSOT Phase 069 Task 3 — NetworkHealthController (ping + batch sync)
// Canonical: apps/backend/src/modules/network/network-health.controller.ts
// (legacy src/backend/modules/network/network-health.controller.ts)
// - GET /api/v1/network/ping (public, no-store, <5ms, <100 bytes).
// - POST /api/v1/network/sync-offline-queue { items[] } (JWT, per-item
//   ack — client clears only acked ids, failed stay queued).
// - POST /api/v1/network/telemetry (JWT-optional; anonymous LIFF readers
//   report with lineUserId + deviceType).
// - Zero new deps.
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { NetworkHealthService } from './network-health.service';
import { OfflineSyncService } from './services/offline-sync.service';

interface NetworkReq {
  user?: { id?: string };
}

@Controller('api/v1/network')
export class NetworkHealthController {
  constructor(
    private readonly health: NetworkHealthService,
    private readonly offlineSync: OfflineSyncService,
  ) {}

  @Get('ping')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  pingCheck(@Query('tenantId') tenantId?: string) {
    return this.health.pingCheck(typeof tenantId === 'string' ? tenantId : undefined);
  }

  @Post('sync-offline-queue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async syncOfflineQueue(@Body() body: { items?: unknown }, @Req() req: NetworkReq) {
    const result = await this.offlineSync.processBatchQueue(body?.items, req.user?.id);
    return { success: result.failedItemIds.length === 0, processedCount: result.processedCount, failedItemIds: result.failedItemIds };
  }

  @Post('telemetry')
  @HttpCode(HttpStatus.ACCEPTED)
  async telemetry(@Body() body: Record<string, unknown>, @Req() req: NetworkReq) {
    const b = body ?? {};
    return this.health.logTelemetry({
      userId: req.user?.id ?? (typeof b['userId'] === 'string' ? b['userId'] : undefined),
      lineUserId: typeof b['lineUserId'] === 'string' ? b['lineUserId'] : undefined,
      deviceType: typeof b['deviceType'] === 'string' ? b['deviceType'] : 'UNKNOWN',
      disconnectionSec: Number(b['disconnectionSec'] ?? 0),
      actionsQueued: Number(b['actionsQueued'] ?? 0),
      effectiveType: typeof b['effectiveType'] === 'string' ? b['effectiveType'] : undefined,
      tenantId: typeof b['tenantId'] === 'string' ? b['tenantId'] : undefined,
    });
  }
}
