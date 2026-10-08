// SSOT Phase 064 §5.1 — BatchSyncController (REST fallback for SW sync)
// Canonical: apps/backend/src/modules/progress/controllers/batch-sync.controller.ts
// (legacy src/backend/modules/progress/controllers/batch-sync.controller.ts)
// - POST /api/v1/progress/batch-sync (JWT; identity from req.user).
// - Zero new deps.
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { ProgressSyncService } from '../services/progress-sync.service';

interface BatchReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

@Controller('api/v1/progress')
export class BatchSyncController {
  constructor(private readonly sync: ProgressSyncService) {}

  @Post('batch-sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async batchSync(@Body() body: unknown, @Req() req: BatchReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ua = req.headers?.['user-agent'] ?? 'ServiceWorker-BackgroundSync';
    return this.sync.processBatchSync(userId, body, ip, ua, req.headers?.['x-device-id']);
  }
}
