// SSOT Phase 063 §5.1 — DrmLeaseController (lease issue + progress sync)
// Canonical: apps/backend/src/modules/offline/controllers/drm-lease.controller.ts
// (legacy src/backend/modules/offline/controllers/drm-lease.controller.ts)
// - POST /api/v1/offline/lease/issue (JWT, entitlement-gated 7-day lease).
// - POST /api/v1/offline/lease/sync (JWT, Zod-gated progress flush <1s).
// - Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { DrmLeaseService } from '../services/drm-lease.service';
import { OfflineSyncService } from '../services/offline-sync.service';
import { IssueLeaseDtoSchema } from '../dto/issue-lease.dto';

interface LeaseReq {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | undefined>;
}

function leaseUserId(req: LeaseReq): string {
  if (!req.user?.id) throw new BadRequestException('Missing session identity');
  return req.user.id;
}

function leaseIp(req: LeaseReq): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

@Controller('api/v1/offline')
export class DrmLeaseController {
  constructor(
    private readonly leases: DrmLeaseService,
    private readonly sync: OfflineSyncService,
  ) {}

  @Post('lease/issue')
  @UseGuards(JwtAuthGuard)
  async issueLease(@Body() body: unknown, @Req() req: LeaseReq) {
    const parsed = IssueLeaseDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid lease request');
    return this.leases.issueOfflineLease(leaseUserId(req), parsed.data.productId, parsed.data.deviceId, parsed.data.clientPublicKey);
  }

  @Post('lease/sync')
  @UseGuards(JwtAuthGuard)
  async syncProgress(@Body() body: unknown, @Req() req: LeaseReq) {
    return this.sync.processOfflineSync(leaseUserId(req), body, leaseIp(req), req.headers?.['x-device-id']);
  }
}
