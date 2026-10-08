// SSOT Phase 078 BDD-2/Task 4 — HLS direct-upload + webhook service
// Canonical: apps/backend/src/modules/course-studio/application/services/hls-transcoder.service.ts
// - presignUpload: Zod gate -> lesson ownership -> R2 PUT presign (15 min)
//   + PROCESSING mark + studio event (direct creator upload, §8.1).
// - applyTranscodeWebhook: HMAC verify -> forward-only transition ->
//   COMPLETED (playlist + duration) / FAILED (retry-queue note, §10).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  STUDIO_EVENT_STREAM,
  STUDIO_PRESIGN_TTL_SEC,
  StudioHlsUploadPresignSchema,
  StudioHlsWebhookSchema,
  studioRawVideoKey,
} from '@repo/shared';
import { assertCourseOwnership, assertStudioTenant } from '../../domain/entities/course-section.entity';
import { assertHlsCompletion, assertTranscodeTransition } from '../../domain/entities/course-lesson.entity';
import type { CourseStudioRepository } from '../../domain/repositories/course-studio.repository.interface';
import type { StudioBus, StudioTx } from './curriculum-builder.service';

export interface PresignR2 {
  presignedPutUrl(objectKey: string, contentType: string, expiresInSeconds: number): string;
}

@Injectable()
export class HlsTranscoderService {
  constructor(
    private readonly repo: CourseStudioRepository,
    private readonly tx: StudioTx,
    private readonly r2: PresignR2,
    private readonly bus: StudioBus,
    private readonly webhookSecret: string,
  ) {}

  async presignUpload(
    headerTenantId: string | undefined,
    actor: { userId: string; role: string | undefined },
    body: unknown,
  ): Promise<{ uploadUrl: string; videoKey: string; expiresInSec: number }> {
    const parsed = StudioHlsUploadPresignSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid HLS upload payload');
    const { tenantId, lessonId, fileName, contentType } = parsed.data;

    const owner = await this.repo.findLessonOwner(lessonId);
    if (!owner) throw new BadRequestException('Lesson not found');
    assertStudioTenant(tenantId, owner.tenantId);
    assertCourseOwnership(owner.sellerId, actor.userId, actor.role);

    const videoKey = studioRawVideoKey(tenantId, lessonId, fileName);
    await this.repo.markTranscoding(lessonId, videoKey);
    await this.bus.xadd(STUDIO_EVENT_STREAM, {
      event: 'studio.hls.upload-started',
      tenantId,
      lessonId,
      at: Date.now(),
    }).catch(() => undefined);
    return {
      uploadUrl: this.r2.presignedPutUrl(videoKey, contentType, STUDIO_PRESIGN_TTL_SEC),
      videoKey,
      expiresInSec: STUDIO_PRESIGN_TTL_SEC,
    };
  }

  async applyTranscodeWebhook(rawBody: unknown): Promise<{ ok: boolean }> {
    const parsed = StudioHlsWebhookSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invalid transcode webhook payload');
    const payload = parsed.data;

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${payload.lessonId}|${payload.status}|${payload.timestamp}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(payload.signature, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid transcode webhook signature');
    }

    const current = await this.repo.transcodeOf(payload.lessonId);
    if (!current) throw new BadRequestException('Lesson not found');
    assertTranscodeTransition(current, payload.status);

    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      if (payload.status === 'COMPLETED') {
        assertHlsCompletion(payload.videoHlsUrl, payload.durationSec);
        await repo.applyHlsCompletion(payload.lessonId, payload.videoHlsUrl as string, payload.durationSec as number);
      } else {
        await repo.markTranscodeFailed(payload.lessonId, payload.errorMessage ?? 'transcode failed');
        await this.bus.xadd(STUDIO_EVENT_STREAM, {
          event: 'studio.hls.retry-queued',
          lessonId: payload.lessonId,
          at: Date.now(),
        }).catch(() => undefined);
      }
    });
    return { ok: true };
  }
}
