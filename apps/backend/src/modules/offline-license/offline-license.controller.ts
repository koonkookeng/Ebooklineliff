// SSOT Phase 068 Task 2 — OfflineLicenseController (REST license + quota)
// Canonical: apps/backend/src/modules/offline-license/offline-license.controller.ts
// (legacy src/backend/modules/offline-license/offline-license.controller.ts)
// - POST /api/v1/offline-license/issue { productId, deviceIdHash,
//   maxOfflineDays? } → signed payload (JWT, entitlement-gated).
// - GET /api/v1/offline-license/status?productId=&deviceIdHash= → validity.
// - POST /api/v1/offline-license/revoke { licenseId } (owner-only).
// - POST /api/v1/offline-license/quota { deviceIdHash, usedBytes } → ledger.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { OfflineLicenseService } from './offline-license.service';

interface LicenseReq {
  user?: { id?: string };
}

@Controller('api/v1/offline-license')
export class OfflineLicenseController {
  constructor(private readonly licenses: OfflineLicenseService) {}

  @Post('issue')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async issue(
    @Body() body: { productId?: unknown; deviceIdHash?: unknown; maxOfflineDays?: unknown },
    @Req() req: LicenseReq,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const res = await this.licenses.issueLicense(
      userId,
      String(body?.productId ?? ''),
      String(body?.deviceIdHash ?? ''),
      Number(body?.maxOfflineDays ?? 7),
    );
    if (!res.ok || !res.payload) throw new BadRequestException(res.error ?? 'ISSUE_FAILED');
    return res.payload;
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(
    @Query('productId') productId: string,
    @Query('deviceIdHash') deviceIdHash: string,
    @Req() req: LicenseReq,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!productId || !deviceIdHash) throw new BadRequestException('productId and deviceIdHash required');
    return this.licenses.getLicense(userId, String(productId), String(deviceIdHash));
  }

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async revoke(@Body() body: { licenseId?: unknown }, @Req() req: LicenseReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return { revoked: await this.licenses.revokeLicense(userId, String(body?.licenseId ?? '')) };
  }

  @Post('quota')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async quota(
    @Body() body: { deviceIdHash?: unknown; usedBytes?: unknown; deviceModel?: unknown },
    @Req() req: LicenseReq,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.licenses.reportQuota(
      userId,
      String(body?.deviceIdHash ?? ''),
      Number(body?.usedBytes ?? 0),
      typeof body?.deviceModel === 'string' ? body.deviceModel : undefined,
    );
  }
}
