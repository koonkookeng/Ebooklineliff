// SSOT Phase 096 — Point claim REST (096-owned, 083 controller untouched)
// Canonical: apps/backend/src/modules/gamification/presentation/rest/point-claim.controller.ts
// - POST claim (member JWT + HMAC nonce). Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { PointEngineService } from '../../services/point-engine.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/points')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PointClaimController {
  constructor(private readonly points: PointEngineService) {}

  @Post('claim')
  claim(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as {
      activityType?: string; referenceId?: string; dwellTimeSec?: number;
      signatureNonce?: string; squadId?: string;
    };
    return this.points.claim({
      userId: actorOf(req),
      squadId: b.squadId,
      input: {
        activityType: b.activityType ?? '',
        referenceId: b.referenceId ?? '',
        dwellTimeSec: b.dwellTimeSec ?? 0,
        signatureNonce: b.signatureNonce ?? '',
      },
    });
  }
}
