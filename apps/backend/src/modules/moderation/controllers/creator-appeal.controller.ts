// SSOT Phase 112 Task 8 §5.1 — creator appeal REST (LIFF self lane)
// Canonical: apps/backend/src/modules/moderation/controllers/creator-appeal.controller.ts
// (legacy src/backend/modules/moderation/.../creator-appeal.controller.ts)
// - POST submit (JWT, owner-only, appeal-eligible only) / GET mine
//   (owner appeal read). Admin decisions ride the admin controller +
//   GQL (dual-guard). Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { AppealManagerService } from '../services/appeal-manager.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/moderation/appeals')
export class CreatorAppealController {
  constructor(private readonly appeals: AppealManagerService) {}

  @Post('submit')
  @UseGuards(JwtAuthGuard, TenantGuard)
  submit(@Req() req: LooseReq, @Body() body: unknown) {
    return this.appeals.submitAppeal(actorOf(req), body);
  }
}
