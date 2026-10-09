// SSOT Phase 092 Task 4 — AI chat REST + SSE stream (JWT + entitlement gate)
// Canonical: apps/backend/src/modules/ai-companion/controllers/ai-chat.controller.ts
// - POST chat (JSON) / SSE stream (token batches) / POST summarize.
//   Frontend NEVER calls LLMs directly (OUT_OF_SCOPE_STRICT) — all answers
//   ride the backend RAG gatekeeper. Zero new deps (rxjs ships with Nest).
import { BadRequestException, Body, Controller, ForbiddenException, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable } from 'rxjs';
import { toStreamBatches } from '@repo/shared';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { CompanionSummarizerService } from '../services/summarizer.service';
import { EntitlementGrantService } from '../../entitlement/services/entitlement-grant.service';
import { PrismaService } from '../../../infra/database/prisma.service';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { userId: string; tenantId: string } {
  const user = (req['user'] as { id?: string } | undefined) ?? {};
  const tenantId = ((req as { tenantId?: string }).tenantId ?? '').trim();
  if (!user.id) throw new BadRequestException('Missing authentication');
  if (!tenantId) throw new BadRequestException('Missing tenant scope');
  return { userId: user.id, tenantId };
}

function hashOf(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

@Controller('api/v1/ai')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AiChatController {
  constructor(
    private readonly companion: CompanionSummarizerService,
    private readonly grants: EntitlementGrantService,
    private readonly prisma: PrismaService,
  ) {}

  private async gate(userId: string, productId: string): Promise<void> {
    const ok = await this.grants.hasAccess(this.prisma as never, userId, productId);
    if (!ok) throw new ForbiddenException('Entitlement required for this product');
  }

  @Post('chat')
  async chat(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    const b = (body ?? {}) as { productId?: string };
    if (!b.productId) throw new BadRequestException('Missing productId');
    await this.gate(userId, b.productId);
    return this.companion.chat({
      userId,
      tenantId,
      userIdHash: hashOf(userId),
      query: (body ?? {}) as never,
    });
  }

  @Sse('chat-stream')
  stream(@Req() req: LooseReq, @Query('productId') productId: string, @Query('q') q: string): Observable<{ data: string }> {
    return new Observable<{ data: string }>((subscriber) => {
      void (async () => {
        try {
          const { userId, tenantId } = actorOf(req);
          if (!productId) throw new BadRequestException('Missing productId');
          await this.gate(userId, productId);
          const r = await this.companion.chat({
            userId,
            tenantId,
            userIdHash: hashOf(userId),
            query: { productId, userQuestion: q ?? '' },
          });
          subscriber.next({ data: JSON.stringify({ type: 'start', sessionId: r.sessionId }) });
          for (const batch of toStreamBatches(r.answerMarkdown)) {
            subscriber.next({ data: JSON.stringify({ type: 'token', text: batch }) });
          }
          subscriber.next({
            data: JSON.stringify({ type: 'done', messageId: r.messageId, citations: r.citations }),
          });
          subscriber.complete();
        } catch (e) {
          subscriber.next({ data: JSON.stringify({ type: 'error', message: (e as Error).message }) });
          subscriber.complete();
        }
      })();
    });
  }

  @Post('summarize')
  async summarize(@Req() req: LooseReq, @Body() body: unknown) {
    const { userId, tenantId } = actorOf(req);
    const b = (body ?? {}) as { productId?: string };
    if (!b.productId) throw new BadRequestException('Missing productId');
    await this.gate(userId, b.productId);
    return this.companion.summarize({
      userId,
      tenantId,
      userIdHash: hashOf(userId),
      request: (body ?? {}) as never,
    });
  }
}
