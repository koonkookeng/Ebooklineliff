// SSOT Phase 099 — Live REST (join/chat-SSE/poll/vote/session/vod intake)
// Canonical: apps/backend/src/modules/live/live.controller.ts
// - RISK_CALL: single-file seam (spec tree lists no controllers/ — the HTTP
//   surface BDD-1/2/3 needs lives here instead of scattering). SSE chat
//   stream, Zod-gated mutations, JWT + tenant guards. Zero new deps.
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateLiveSessionSchema } from './application/dtos/create-live-session.dto';
import { JoinLiveStreamSchema, WebrtcOfferSchema } from './application/dtos/join-live-stream.dto';
import { MintPlaybackTokenUseCase } from './application/use-cases/mint-ivs-token.usecase';
import { HandleWebrtcSignalingUseCase } from './application/use-cases/handle-webrtc-signaling.usecase';
import { ConvertLiveToVodUseCase } from './application/use-cases/convert-live-to-vod.usecase';
import { LiveChatGateway } from './infrastructure/websocket/live-chat.gateway';
import { PrismaLiveRepository } from './infrastructure/persistence/live-session.repository';
import { assertTransition, type LiveStatus } from './domain/entities/live-session.entity';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/live')
export class LiveController {
  constructor(
    private readonly access: MintPlaybackTokenUseCase,
    private readonly signaling: HandleWebrtcSignalingUseCase,
    private readonly vod: ConvertLiveToVodUseCase,
    private readonly chat: LiveChatGateway,
    private readonly repo: PrismaLiveRepository,
  ) {}

  @Post('sessions')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async createSession(@Req() req: LooseReq, @Body() body: unknown) {
    const parsed = CreateLiveSessionSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid live session input');
    return this.repo.createSession({
      productId: parsed.data.productId,
      instructorId: actorOf(req),
      title: parsed.data.title,
      description: parsed.data.description,
      coverImageUrl: parsed.data.coverImageUrl,
      vendor: parsed.data.vendor,
      status: parsed.data.status,
      streamKey: `live-${randomUUID()}`,
      scheduledAt: new Date(parsed.data.scheduledAt),
    });
  }

  @Post('join')
  @UseGuards(JwtAuthGuard, TenantGuard)
  join(@Req() req: LooseReq, @Body() body: unknown) {
    const parsed = JoinLiveStreamSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid join request');
    return this.access.join({ sessionId: parsed.data.sessionId, userId: actorOf(req) });
  }

  @Post('webrtc/answer')
  @UseGuards(JwtAuthGuard, TenantGuard)
  webrtcAnswer(@Req() req: LooseReq, @Body() body: unknown) {
    const parsed = WebrtcOfferSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid SDP offer');
    return this.signaling.answer({ sessionId: parsed.data.sessionId, userId: actorOf(req), sdpOffer: parsed.data.sdpOffer });
  }

  @Post('sessions/:id/transition')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async transition(@Param('id') id: string, @Body() body: unknown) {
    const to = ((body ?? {}) as { status?: string }).status ?? '';
    const current = await this.repo.findSessionById(id);
    if (!current) throw new BadRequestException('Live session not found');
    try {
      assertTransition(current.status as LiveStatus, to as LiveStatus);
    } catch {
      throw new BadRequestException(`Illegal transition ${current.status} → ${to}`);
    }
    const patch: Record<string, unknown> =
      to === 'LIVE' ? { startedAt: new Date() } : to === 'ENDED' ? { endedAt: new Date() } : {};
    return this.repo.setStatus(id, to, patch);
  }

  @Get('sessions/:id/chat')
  @UseGuards(JwtAuthGuard, TenantGuard)
  chatHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.chat.history(id, limit ? Number(limit) : 50);
  }

  @Post('sessions/:id/chat')
  @UseGuards(JwtAuthGuard, TenantGuard)
  postChat(@Req() req: LooseReq, @Param('id') id: string, @Body() body: unknown) {
    const b = (body ?? {}) as { content?: string; stickerPackageId?: string; stickerId?: string };
    if (typeof b.content !== 'string') throw new BadRequestException('Invalid chat content');
    return this.chat.post({ sessionId: id, userId: actorOf(req), content: b.content, stickerPackageId: b.stickerPackageId, stickerId: b.stickerId });
  }

  @Sse('sessions/:id/chat/stream')
  chatStream(@Param('id') id: string): Observable<{ data: unknown }> {
    return new Observable((subscriber) => {
      const release = this.chat.subscribe(id, {
        write: (chunk: string) => subscriber.next({ data: chunk }),
      });
      return release;
    });
  }

  @Post('polls')
  @UseGuards(JwtAuthGuard, TenantGuard)
  createPoll(@Body() body: unknown) {
    const b = (body ?? {}) as { sessionId?: string; question?: string; options?: string[]; expiresAt?: string };
    if (!b.sessionId || !b.question || !Array.isArray(b.options) || b.options.length < 2) {
      throw new BadRequestException('Invalid poll input');
    }
    return this.repo.createPoll({
      sessionId: b.sessionId,
      question: b.question.slice(0, 500),
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      options: b.options.slice(0, 6).map((o) => String(o).slice(0, 120)),
    });
  }

  @Post('polls/vote')
  @UseGuards(JwtAuthGuard, TenantGuard)
  vote(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { pollId?: string; optionId?: string };
    if (!b.pollId || !b.optionId) throw new BadRequestException('Invalid vote');
    return this.repo.votePoll({ pollId: b.pollId, optionId: b.optionId, userId: actorOf(req) });
  }

  @Get('polls/:pollId/tally')
  @UseGuards(JwtAuthGuard, TenantGuard)
  tally(@Param('pollId') pollId: string) {
    return this.repo.pollTally(pollId);
  }

  // STREAM_ENDED webhook intake (BDD-3 → VOD pipeline; idempotent).
  @Post('webhooks/stream-ended')
  streamEnded(@Body() body: unknown, @Res() res: { status: (c: number) => { json: (b: unknown) => unknown } }) {
    const b = (body ?? {}) as { sessionId?: string; durationSec?: number; fileSizeBytes?: number; lessonId?: string };
    if (!b.sessionId) return res.status(400).json({ message: 'Missing sessionId' });
    return this.vod
      .convert({ sessionId: b.sessionId, durationSec: b.durationSec, fileSizeBytes: b.fileSizeBytes, lessonId: b.lessonId })
      .then((r) => res.status(200).json(r))
      .catch((e: Error) => res.status(400).json({ message: e.message }));
  }
}
