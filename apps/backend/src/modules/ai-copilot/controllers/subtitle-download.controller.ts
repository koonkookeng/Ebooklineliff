// SSOT Phase 094 §8.2 — Subtitle download (5-min HMAC ticket, entitlement gate)
// Canonical: apps/backend/src/modules/ai-copilot/controllers/subtitle-download.controller.ts
// - GET vtt/srt by lessonId + ticket. Ticket = HMAC(lessonId.exp, secret),
//   5-minute TTL, learner-bound session check via entitlement read.
// - Zero new deps (node:crypto only).
import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { buildSrt, buildVtt } from '@repo/shared';
import { subtitleTicket, verifySubtitleTicket } from '../utils/subtitle-ticket.util';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';
import { PrismaService } from '../../../infra/database/prisma.service';

type LooseReq = Record<string, unknown>;

// Structural reply (media-vault precedent — no express dep on Fastify core).
interface SubtitleReply {
  status: (code: number) => SubtitleReply;
  header: (key: string, value: string) => SubtitleReply;
  send: (body: string) => unknown;
}

function actorOf(req: LooseReq): string {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return user.id;
}

@Controller('api/v1/subtitles')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SubtitleDownloadController {
  constructor(
    private readonly grants: EntitlementGrantService,
    private readonly prisma: PrismaService,
    private readonly secret: string = process.env['SUBTITLE_TICKET_SECRET'] || 'dev-subtitle-secret',
  ) {}

  @Get('ticket')
  async ticket(@Req() req: LooseReq, @Query('lessonId') lessonId: string | undefined) {
    if (!lessonId) throw new BadRequestException('Missing lessonId');
    const exp = Date.now() + 5 * 60 * 1000;
    return { ticket: subtitleTicket(lessonId, exp, this.secret), exp };
  }

  @Get('vtt')
  async vtt(
    @Req() req: LooseReq,
    @Query('lessonId') lessonId: string | undefined,
    @Query('ticket') ticket: string | undefined,
    @Query('exp') expRaw: string | undefined,
    @Res() res: SubtitleReply,
  ): Promise<void> {
    await this.serve('vtt', req, lessonId, ticket, expRaw, res);
  }

  @Get('srt')
  async srt(
    @Req() req: LooseReq,
    @Query('lessonId') lessonId: string | undefined,
    @Query('ticket') ticket: string | undefined,
    @Query('exp') expRaw: string | undefined,
    @Res() res: SubtitleReply,
  ): Promise<void> {
    await this.serve('srt', req, lessonId, ticket, expRaw, res);
  }

  private async serve(
    kind: 'vtt' | 'srt',
    req: LooseReq,
    lessonId: string | undefined,
    ticket: string | undefined,
    expRaw: string | undefined,
    res: SubtitleReply,
  ): Promise<void> {
    const userId = actorOf(req);
    const exp = Number(expRaw);
    if (!lessonId || !ticket || !Number.isFinite(exp)) throw new BadRequestException('Missing ticket');
    if (!verifySubtitleTicket(ticket, lessonId, exp, this.secret)) {
      throw new ForbiddenException('Invalid or expired subtitle ticket');
    }
    const db = this.prisma as unknown as {
      courseLesson: {
        findUnique: (args: unknown) => Promise<{ id: string; section: { course: { productId: string } } } | null>;
      };
      videoSubtitle: {
        findUnique: (args: unknown) => Promise<{ segments: Array<{ segmentIndex: number; startTimeSec: number; endTimeSec: number; textContent: string }> } | null>;
      };
    };
    const lesson = await db.courseLesson
      .findUnique({ where: { id: lessonId }, include: { section: { include: { course: true } } } })
      .catch(() => null);
    if (!lesson) throw new BadRequestException('Lesson not found');
    const ok = await this.grants.hasAccess(this.prisma as never, userId, lesson.section.course.productId);
    if (!ok) throw new ForbiddenException('Entitlement required for this lesson');
    const sub = await db.videoSubtitle.findUnique({ where: { lessonId }, include: { segments: { orderBy: { segmentIndex: 'asc' } } } }).catch(() => null);
    if (!sub) throw new BadRequestException('No subtitles for this lesson');
    const cues = sub.segments.map((s) => ({ startTimeSec: s.startTimeSec, endTimeSec: s.endTimeSec, text: s.textContent }));
    const body = kind === 'vtt' ? buildVtt(cues) : buildSrt(cues);
    res.header('Content-Type', kind === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8');
    res.header('Cache-Control', 'private, max-age=240');
    res.send(body);
  }
}
