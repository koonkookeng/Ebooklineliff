// SSOT Phase 035 Task 2/§5.2 — Sandbox audit REST controller (QA-gated)
// Canonical: apps/backend/src/modules/line-sandbox/controllers/line-sandbox-audit.controller.ts
// (legacy src/backend/modules/line-sandbox/controllers/line-sandbox-audit.controller.ts)
// - POST /api/v1/line-sandbox/run-audit (JWT; session subject wins over any
//   body userId — Phase 027 actor precedent, no cross-user audit forgery).
// - GET  /api/v1/line-sandbox/audits/latest?tenantId= (JWT read).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { LineSandboxRunnerService } from '../services/line-sandbox-runner.service';
import { LineReviewVerifierService } from '../services/line-review-verifier.service';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';

interface AuthedReq {
  user?: { id?: string };
}

function actor(req: AuthedReq, bodyUserId?: unknown): string {
  if (req.user?.id) {
    if (typeof bodyUserId === 'string' && bodyUserId && bodyUserId !== req.user.id) {
      throw new BadRequestException('userId mismatch with session identity');
    }
    return req.user.id;
  }
  throw new UnauthorizedException('Unauthorized');
}

@Controller('api/v1/line-sandbox')
export class LineSandboxAuditController {
  constructor(
    private readonly runner: LineSandboxRunnerService,
    private readonly verifier: LineReviewVerifierService,
  ) {}

  @Post('run-audit')
  @UseGuards(JwtAuthGuard)
  runAudit(@Body() body: Record<string, unknown>, @Req() req: AuthedReq) {
    const userId = actor(req, body['userId']);
    return this.runner.executeAllCheckers({ ...(body as object), userId });
  }

  @Get('audits/latest')
  @UseGuards(JwtAuthGuard)
  latest(@Query('tenantId') tenantId: string | undefined) {
    if (!tenantId) throw new BadRequestException('Missing tenant id');
    return this.verifier.latestAudit(tenantId);
  }
}
