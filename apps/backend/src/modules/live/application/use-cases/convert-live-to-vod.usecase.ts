// SSOT Phase 099 BDD-3 — Live-to-VOD use-case (STREAM_ENDED → R2 archive)
// Canonical: apps/backend/src/modules/live/application/use-cases/convert-live-to-vod.usecase.ts
// - Session must be ENDED (STREAM_ENDED webhook flips LIVE → ENDED first) →
//   idempotent VOD row (one per session) → R2 manifest key + master URL →
//   optional CourseLesson attach ($0 egress, Gate 6). Zero new deps.
import { Injectable } from '@nestjs/common';
import { LIVE_STREAM } from '@repo/shared';
import { isVodEligible, type LiveStatus } from '../../domain/entities/live-session.entity';
import { CloudflareR2VodAdapter } from '../../infrastructure/adapters/cloudflare-r2-vod.adapter';
import type { LiveRepository } from '../../infrastructure/persistence/live-session.repository';
import type { LiveBus } from './mint-ivs-token.usecase';

@Injectable()
export class ConvertLiveToVodUseCase {
  constructor(
    private readonly repo: LiveRepository,
    private readonly vod: CloudflareR2VodAdapter,
    private readonly bus: Pick<LiveBus, 'xadd'>,
  ) {}

  async convert(args: {
    sessionId: string;
    durationSec?: number;
    fileSizeBytes?: number | string;
    lessonId?: string;
  }): Promise<{ vodId: string; hlsMasterUrl: string; storagePathR2: string }> {
    const session = await this.repo.findSessionById(args.sessionId);
    if (!session) throw new Error('Live session not found');
    if (!isVodEligible(session.status as LiveStatus)) throw new Error(`Session is ${session.status}, VOD not eligible`);
    if (session.status !== 'ENDED') {
      await this.repo.setStatus(session.id, 'ENDED', { endedAt: new Date() });
    }

    const storagePathR2 = this.vod.masterKey(session.id);
    const hlsMasterUrl = this.vod.masterUrl(session.id);
    // Idempotent retry: STREAM_ENDED webhooks redeliver — return the
    // existing VOD row instead of faulting on the @unique sessionId.
    const existing = await this.repo.findVodBySession(session.id).catch(() => null);
    if (existing) {
      if (args.lessonId) await this.repo.attachVodToLesson(args.lessonId, existing.hlsMasterUrl);
      return { vodId: existing.id, hlsMasterUrl: existing.hlsMasterUrl, storagePathR2: existing.storagePathR2 };
    }
    await this.vod.archiveManifest(
      session.id,
      `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n`,
    );
    const row = await this.repo.createVodRecord({
      sessionId: session.id,
      storagePathR2,
      hlsMasterUrl,
      durationSec: args.durationSec ?? 0,
      fileSizeBytes: BigInt(args.fileSizeBytes ?? 0),
    });
    if (args.lessonId) {
      await this.repo.attachVodToLesson(args.lessonId, hlsMasterUrl);
    }
    await this.bus
      .xadd(LIVE_STREAM, { event: 'live.vod.ready', sessionId: session.id, at: Date.now() })
      .catch(() => undefined);
    return { vodId: row.id, hlsMasterUrl, storagePathR2 };
  }
}
