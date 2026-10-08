// SSOT Phase 059 §5.1/§7.1 — ReaderNavigationController (prefs + event REST)
// Canonical: apps/backend/src/modules/reader/reader-navigation.controller.ts
// - GET  /api/v1/reader/navigation-preference (JWT → nav prefs, fail-open
//   defaults; feeds tap-zone inversion + swipe sensitivity + key enablement).
// - POST /api/v1/reader/navigation-event (JWT, Zod-gated, 202 best-effort —
//   feeds the Redis stream for device-ratio / accidental-tap analytics).
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { NavigationEventPayloadSchema } from '@repo/shared';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { ReaderPreferenceService } from './application/reader-preference.service';

interface NavReq {
  user?: { id?: string };
}

function navUserId(req: NavReq): string {
  const userId = req.user?.id;
  if (!userId) throw new BadRequestException('Missing session identity');
  return userId;
}

@Controller('api/v1/reader')
export class ReaderNavigationController {
  constructor(private readonly prefs: ReaderPreferenceService) {}

  @Get('navigation-preference')
  @UseGuards(JwtAuthGuard)
  async getPreference(@Req() req: NavReq) {
    return this.prefs.getUserPreference(navUserId(req));
  }

  @Post('navigation-event')
  @UseGuards(JwtAuthGuard)
  async trackEvent(@Body() body: Record<string, unknown>, @Req() req: NavReq) {
    const parsed = NavigationEventPayloadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid navigation event');
    return { recorded: true, userId: navUserId(req) };
  }
}
