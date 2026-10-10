// SSOT Phase 112 Task 6 §5.1 — moderation scan REST (trigger + status)
// Canonical: apps/backend/src/modules/moderation/controllers/moderation-webhook.controller.ts
// (legacy src/backend/modules/moderation/.../moderation-webhook.controller.ts)
// - POST scan (JWT: seller/admin — enqueues FIFO job, sync-run when
//   ?sync=1 for the <1.5s BDD path) / POST rescan (rate-shielded) /
//   GET status (ownership-checked). Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { ModerationEngineService } from '../services/moderation-engine.service';
import { ModerationQueueProcessor } from '../queues/moderation.processor';
import { ModerationContentTypeEnum } from '@repo/shared';

type LooseReq = Record<string, unknown>;

function actorOf(req: LooseReq): { id: string; role: string | undefined } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return { id: user.id, role: user.role };
}

function tenantOf(req: LooseReq): string {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default';
}

@Controller('api/v1/moderation')
export class ModerationWebhookController {
  constructor(
    private readonly engine: ModerationEngineService,
    private readonly queue: ModerationQueueProcessor,
  ) {}

  @Post('scan')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async scan(@Req() req: LooseReq, @Body() body: unknown, @Query('sync') sync: string | undefined) {
    const b = (body ?? {}) as { productId?: string; contentType?: string; frames?: Array<{ key: string; nsfwScore?: number }>; binaryDigests?: Array<{ digest: string; location: string }> };
    if (!b.productId) throw new BadRequestException('Missing productId');
    const parsed = ModerationContentTypeEnum.safeParse(b.contentType ?? 'EBOOK');
    if (!parsed.success) throw new BadRequestException('Invalid contentType');
    if (sync === '1') {
      return this.engine.processContentModeration(b.productId, { contentType: parsed.data, frames: b.frames, binaryDigests: b.binaryDigests }, tenantOf(req));
    }
    const pending = this.queue.enqueue({ productId: b.productId, contentType: parsed.data, inputs: { frames: b.frames, binaryDigests: b.binaryDigests }, tenantName: tenantOf(req) });
    return { queued: true, pending };
  }

  @Post('rescan')
  @UseGuards(JwtAuthGuard, TenantGuard)
  rescan(@Req() req: LooseReq, @Body() body: unknown) {
    const b = (body ?? {}) as { productId?: string };
    if (!b.productId) throw new BadRequestException('Missing productId');
    return this.engine.triggerRescan(b.productId, tenantOf(req));
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, TenantGuard)
  status(@Req() req: LooseReq, @Query('productId') productId: string | undefined) {
    if (!productId) throw new BadRequestException('Missing productId');
    return this.engine.getStatus(productId, actorOf(req));
  }
}
