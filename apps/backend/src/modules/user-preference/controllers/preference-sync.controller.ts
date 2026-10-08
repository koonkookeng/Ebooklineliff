// SSOT Phase 066 BDD-1/2 — PreferenceSyncController (REST + SSE fan-out)
// Canonical: apps/backend/src/modules/user-preference/controllers/preference-sync.controller.ts
// (legacy src/backend/modules/user-preference/controllers/preference-sync.controller.ts)
// - GET /api/v1/preferences (JWT) — read-through preference.
// - PATCH /api/v1/preferences { ...fields, triggerSource? } — update+fan-out.
// - POST /api/v1/preferences/sync { preference } — offline LWW drain (JWT).
// - SSE GET /api/v1/preferences/stream?userId= — room fan-out (<100ms).
// - Zero new deps (rxjs + @Sse are existing).
import { BadRequestException, Body, Controller, Get, Patch, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PREFERENCE_UPDATED_EVENT, preferenceChannel } from '@repo/shared';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { UserPreferenceService } from '../user-preference.service';
import type { UserPreferenceEntity } from '../entities/user-preference.entity';

interface PreferenceReq {
  user?: { id?: string };
}

export interface PreferenceRoomBus {
  subscribeRoom(channel: string, event: string, handler: (data: unknown) => void): Promise<() => void>;
}

@Controller('api/v1/preferences')
export class PreferenceSyncController {
  constructor(
    private readonly prefs: UserPreferenceService,
    private readonly rooms?: PreferenceRoomBus,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async get(@Req() req: PreferenceReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    return this.prefs.getPreference(userId);
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  async update(@Body() body: Record<string, unknown> & { triggerSource?: string }, @Req() req: PreferenceReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    const { triggerSource, ...fields } = body ?? {};
    const res = await this.prefs.updatePreference(userId, fields, typeof triggerSource === 'string' ? triggerSource : 'READER_TOOLBAR');
    if (!res.ok || !res.preference) throw new BadRequestException(res.error ?? 'UPDATE_FAILED');
    return res.preference;
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  async sync(@Body() body: { preference?: Partial<UserPreferenceEntity> & { updatedAt: string } }, @Req() req: PreferenceReq) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Missing session identity');
    if (!body?.preference?.updatedAt) throw new BadRequestException('preference.updatedAt required');
    return this.prefs.syncOfflinePreference(userId, body.preference);
  }

  /** SSE fan-out: cross-device theme sync within 100ms (BDD-1). */
  @Sse('stream')
  stream(@Query('userId') userId: string): Observable<{ data: unknown }> {
    const channel = preferenceChannel(String(userId ?? ''));
    return new Observable<{ data: unknown }>((subscriber) => {
      let teardown: (() => void) | null = null;
      let released = false;
      void this.rooms
        ?.subscribeRoom(channel, PREFERENCE_UPDATED_EVENT, (data) => {
          subscriber.next({ data });
        })
        .then((u) => {
          teardown = u;
        })
        .catch(() => undefined);
      return () => {
        if (released) return;
        released = true;
        try {
          teardown?.();
        } catch {
          // unsubscribe best-effort
        }
      };
    });
  }
}
