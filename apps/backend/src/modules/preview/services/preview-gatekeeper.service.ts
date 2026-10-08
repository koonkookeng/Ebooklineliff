// SSOT Phase 051 §5.2 — preview gatekeeper (entitlement + 10-page / 120s boundaries)
// Canonical: apps/backend/src/modules/preview/services/preview-gatekeeper.service.ts
// (legacy src/backend/modules/entitlement/preview-gatekeeper.service.ts —
//  that path holds a re-export alias; this file owns the logic.)
// - Entitled ⇒ full access (isPreviewMode: false). Otherwise strict server-edge
//   cutoff: page > previewPages ⇒ 403 PREVIEW_LIMIT_EXCEEDED; video beyond
//   previewLimitSec is fenced by signed segment tokens + player cutoff.
// - Constructor takes ports — no Nest param decorators (tsx-importable).
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PREVIEW_EBOOK_DEFAULT_PAGES,
  PREVIEW_VIDEO_DEFAULT_SEC,
  PreviewEventInputSchema,
  isEbookPageAllowed,
  previewLimitMessage,
  previewUsageId,
  type PreviewEventInput,
} from '@repo/shared';

export interface PreviewDbPort {
  entitlement: {
    findUnique(a: unknown): Promise<{ id: string } | null>;
  };
  ebookDetail: {
    findUnique(a: unknown): Promise<{ previewPages: number } | null>;
  };
  courseLesson: {
    findUnique(a: unknown): Promise<{
      id: string;
      isPreviewAllowed: boolean;
      previewLimitSec: number;
      durationSec: number;
      section: { course: { productId: string } };
    } | null>;
  };
  previewUsageLog: {
    findUnique(a: unknown): Promise<{ maxPageReached: number; maxSecWatched: number } | null>;
    create(a: unknown): Promise<unknown>;
    update(a: unknown): Promise<unknown>;
  };
}

export interface PreviewEventSink {
  emit(message: string): Promise<void>;
}

export interface PreviewIdentity {
  userId: string | null;
  lineUserId?: string;
}

@Injectable()
export class PreviewGatekeeperService {
  constructor(
    private readonly db: PreviewDbPort,
    private readonly events?: PreviewEventSink,
  ) {}

  private identityKey(id: PreviewIdentity): string {
    return id.userId ?? id.lineUserId ?? 'anon';
  }

  async hasEntitlement(userId: string | null, productId: string): Promise<boolean> {
    if (!userId) return false;
    const row = await this.db.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    return row !== null;
  }

  async validateEbookPageAccess(
    id: PreviewIdentity,
    productId: string,
    targetPage: number,
  ): Promise<{ isAllowed: true; isPreviewMode: boolean; maxPreviewPages: number; isLastPreviewPage: boolean }> {
    if (await this.hasEntitlement(id.userId, productId)) {
      return { isAllowed: true, isPreviewMode: false, maxPreviewPages: Number.MAX_SAFE_INTEGER, isLastPreviewPage: false };
    }
    const detail = await this.db.ebookDetail.findUnique({ where: { productId } });
    if (!detail) throw new NotFoundException('E-Book product details not found');
    const maxPreviewPages = detail.previewPages || PREVIEW_EBOOK_DEFAULT_PAGES;
    if (!isEbookPageAllowed(targetPage, maxPreviewPages)) {
      throw new ForbiddenException({
        code: 'PREVIEW_LIMIT_EXCEEDED',
        message: previewLimitMessage('EBOOK', maxPreviewPages),
        maxAllowedPages: maxPreviewPages,
      });
    }
    return {
      isAllowed: true,
      isPreviewMode: true,
      maxPreviewPages,
      isLastPreviewPage: targetPage === maxPreviewPages,
    };
  }

  async validateVideoPreviewAccess(
    id: PreviewIdentity,
    lessonId: string,
  ): Promise<{ isAllowed: true; isPreviewMode: boolean; maxAllowedSec: number; productId: string }> {
    const lesson = await this.db.courseLesson.findUnique({
      where: { id: lessonId },
      include: { section: { include: { course: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const productId = lesson.section.course.productId;
    if (await this.hasEntitlement(id.userId, productId)) {
      return { isAllowed: true, isPreviewMode: false, maxAllowedSec: lesson.durationSec, productId };
    }
    if (!lesson.isPreviewAllowed) {
      throw new ForbiddenException('ไม่อนุญาตให้ทดลองดูวิดีโอบทนี้');
    }
    return {
      isAllowed: true,
      isPreviewMode: true,
      maxAllowedSec: lesson.previewLimitSec || PREVIEW_VIDEO_DEFAULT_SEC,
      productId,
    };
  }

  /** Fire-and-forget engagement log (Gate 7: never blocks the hot path). */
  async recordPreviewEvent(id: PreviewIdentity, input: PreviewEventInput): Promise<boolean> {
    const parsed = PreviewEventInputSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid preview event: ${parsed.error.message}`);
    const identity = this.identityKey(id);
    const rowId = previewUsageId(parsed.data.contentType, identity, parsed.data.productId);
    try {
      const prev = await this.db.previewUsageLog.findUnique({ where: { id: rowId } });
      const patch =
        parsed.data.contentType === 'EBOOK'
          ? { maxPageReached: Math.max(prev?.maxPageReached ?? 0, parsed.data.reachedValue) }
          : { maxSecWatched: Math.max(prev?.maxSecWatched ?? 0, parsed.data.reachedValue) };
      if (prev) {
        await this.db.previewUsageLog.update({ where: { id: rowId }, data: patch });
      } else {
        await this.db.previewUsageLog.create({
          data: {
            id: rowId,
            userId: id.userId,
            lineUserId: parsed.data.lineUserId ?? id.lineUserId,
            productId: parsed.data.productId,
            contentType: parsed.data.contentType,
            ...patch,
          },
        });
      }
      await this.events?.emit(JSON.stringify({ ...parsed.data, identity })).catch(() => undefined);
    } catch {
      // analytics only — preview delivery must never fail because logging did
    }
    return true;
  }
}
