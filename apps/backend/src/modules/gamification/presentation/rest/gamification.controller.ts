// SSOT Phase 083 — Gamification REST (hub/proxy transport + admin sweep)
// Canonical: apps/backend/src/modules/gamification/presentation/rest/gamification.controller.ts
// (ADDITIVE to the §5.1 tree: LIFF clients ride zero-dep REST proxies —
// 080–082 precedent. GQL intents stay canonical in gamification.resolver.ts.)
// - GET profile/badges/catalog, POST checkin/redeem/freeze (JWT+Tenant).
// - POST admin/streak-sweep (admin role; Task 4 cron-ready, no new deps).
// - Zero new deps.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { DailyCheckinUseCase } from '../../application/use-cases/daily-checkin.use-case';
import { RedeemRewardUseCase } from '../../application/use-cases/redeem-reward.use-case';
import { EvaluateBadgesUseCase } from '../../application/use-cases/evaluate-badges.use-case';
import { StreakMaintenanceService } from '../../application/streak-maintenance.service';
import { GamificationResolver } from '../graphql/gamification.resolver';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { id: string; role?: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, ...(user.role ? { role: user.role } : {}) };
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR']);

@Controller('api/v1/gamification')
export class GamificationController {
  constructor(
    private readonly checkin: DailyCheckinUseCase,
    private readonly redeem: RedeemRewardUseCase,
    private readonly evaluate: EvaluateBadgesUseCase,
    private readonly sweep: StreakMaintenanceService,
    private readonly gql: GamificationResolver,
  ) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard, TenantGuard)
  profile(@Req() req: LooseReq) {
    return this.gql.getGamificationProfile({ req } as never);
  }

  @Get('badges')
  @UseGuards(JwtAuthGuard, TenantGuard)
  badges(@Req() req: LooseReq) {
    return this.gql.getUserBadges({ req } as never);
  }

  @Get('catalog')
  @UseGuards(JwtAuthGuard, TenantGuard)
  catalog(@Req() req: LooseReq) {
    return this.gql.getRewardCatalog({ req } as never);
  }

  @Post('checkin')
  @UseGuards(JwtAuthGuard, TenantGuard)
  checkinNow(@Req() req: LooseReq) {
    return this.checkin.execute(actorOf(req).id);
  }

  @Post('redeem')
  @UseGuards(JwtAuthGuard, TenantGuard)
  redeemNow(@Req() req: LooseReq, @Body() body: unknown) {
    return this.redeem.execute(actorOf(req).id, body);
  }

  @Post('freeze/buy')
  @UseGuards(JwtAuthGuard, TenantGuard)
  buyFreeze(@Req() req: LooseReq) {
    return this.gql.buyStreakFreezeWithPoints({ req } as never);
  }

  @Post('evaluate')
  @UseGuards(JwtAuthGuard, TenantGuard)
  evaluateNow(@Req() req: LooseReq) {
    return this.evaluate.execute(actorOf(req).id);
  }

  @Post('admin/streak-sweep')
  @UseGuards(JwtAuthGuard, TenantGuard)
  sweepNow(@Req() req: LooseReq, @Query('at') _at: string | undefined) {
    void _at;
    const actor = actorOf(req);
    if (!actor.role || !ADMIN_ROLES.has(actor.role)) {
      throw new ForbiddenException('Streak sweep requires admin role');
    }
    return this.sweep.sweep();
  }
}
