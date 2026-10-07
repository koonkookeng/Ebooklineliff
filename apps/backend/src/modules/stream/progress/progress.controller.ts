// SSOT Phase 046 Task 2 — ProgressController (sync + beacon REST)
// Canonical: apps/backend/src/modules/stream/progress/progress.controller.ts
// (legacy src/backend/modules/stream/progress/progress.controller.ts)
// - POST /api/v1/stream/progress/sync (JWT): Zod-gated heartbeat.
// - POST /api/v1/stream/progress/beacon (public, sendBeacon-shaped):
//   sendBeacon sends no Authorization header, so identity rides the body
//   (spec §5.2 verbatim). Anti-cheat runs identically server-side
//   (monotonic + velocity + clamp), so a spoofed userId can only move its
//   OWN claimed row forward — never another session's.
// - Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { BeaconProgressSchema, SyncProgressInputSchema } from '@repo/shared';
import { ProgressService } from './progress.service';

interface ProgressReq {
  user?: { id?: string };
}

@Controller('api/v1/stream/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  async sync(@Body() body: Record<string, unknown>, @Req() req: ProgressReq) {
    const parsed = SyncProgressInputSchema.safeParse({ ...body, clientTimestamp: typeof body['clientTimestamp'] === 'string' ? body['clientTimestamp'] : new Date().toISOString() });
    if (!parsed.success) throw new BadRequestException('Invalid progress input');
    if (!req.user?.id) throw new BadRequestException('Missing session identity');
    return this.progress.bufferProgressSync(req.user.id, parsed.data);
  }

  @Post('beacon')
  async beacon(@Body() body: Record<string, unknown>) {
    const raw = typeof body === 'string' ? (JSON.parse(body) as unknown) : body;
    const parsed = BeaconProgressSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid beacon payload');
    return this.progress.bufferProgressSync(parsed.data.userId, parsed.data.input);
  }
}
