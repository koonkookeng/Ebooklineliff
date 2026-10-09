// SSOT Phase 102 Task 3/4 — VOD pipeline orchestrator (ledger + FIFO)
// Canonical: apps/backend/src/modules/stream/application/live-to-vod.service.ts
// - ingest(webhook): Zod gate → TranscodeJob ledger row (PROCESSING_VOD,
//   idempotent per session) → FIFO enqueue (043 queue, no BullMQ) →
//   progress events (<30s SLA, Gate 8).
// - complete/failed: worker callbacks flip the ledger + lesson + notify.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { VOD_STREAM, vodJobKey, vodProgress, vodProgressKey } from '@repo/shared';
import { isVodTrigger, parseStreamEvent } from '../domain/events/stream-ended.event';

export interface VodJobLedger {
  upsertJob(data: { liveSessionId: string; lessonId: string }): Promise<{ id: string; progressPct: number }>;
  setProgress(liveSessionId: string, progressPct: number): Promise<void>;
  completeJob(liveSessionId: string, data: { hlsManifestPath: string; durationSec: number }): Promise<void>;
  failJob(liveSessionId: string, errorMessage: string): Promise<void>;
  findJobBySession(liveSessionId: string): Promise<{ id: string; lessonId: string; progressPct: number; hlsManifestPath: string | null; errorMessage: string | null } | null>;
}

export interface VodQueue {
  enqueue(job: { jobId: string; videoId: string; run: () => Promise<void> }): void;
}

export interface VodEvents {
  xaddPipeline(stream: string, batch: Array<Record<string, string | number>>): Promise<void>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export interface VodNotifier {
  notifyVodReady(args: { lessonId: string; sessionId: string; hlsUrl: string }): Promise<void>;
}

export interface VodSummary {
  summarize(args: { lessonId: string; title: string; durationSec: number }): Promise<string>;
}

@Injectable()
export class LiveToVodService {
  constructor(
    private readonly ledger: VodJobLedger,
    private readonly queue: VodQueue,
    private readonly events: VodEvents,
    private readonly runJob: (job: { liveSessionId: string; lessonId: string; tenantId: string; rawSourceUrl?: string }) => Promise<void>,
  ) {}

  async ingest(raw: unknown): Promise<{ received: boolean; queued: boolean; jobId?: string }> {
    const event = parseStreamEvent(raw);
    if (!event || !isVodTrigger(event)) return { received: true, queued: false };
    const existing = await this.ledger.findJobBySession(event.sessionId).catch(() => null);
    if (existing && existing.hlsManifestPath) return { received: true, queued: false, jobId: existing.id };
    const job = await this.ledger.upsertJob({ liveSessionId: event.sessionId, lessonId: event.lessonId });
    // STREAM_END without a recording URL only arms the ledger — the actual
    // bytes arrive with RECORDING_COMPLETE (no doomed FIFO jobs).
    if (event.eventType === 'STREAM_END' && !event.recordingUrl) {
      return { received: true, queued: false, jobId: job.id };
    }
    const key = vodJobKey(event.sessionId);
    const payload = { liveSessionId: event.sessionId, lessonId: event.lessonId, tenantId: event.tenantId, rawSourceUrl: event.recordingUrl };
    this.queue.enqueue({
      jobId: key,
      videoId: event.sessionId,
      run: () => this.runJob(payload),
    });
    await this.events
      .xaddPipeline(VOD_STREAM, [{ event: 'live.vod.queued', sessionId: event.sessionId, lessonId: event.lessonId, at: Date.now() }])
      .catch(() => undefined);
    return { received: true, queued: true, jobId: job.id };
  }

  async reportProgress(liveSessionId: string, lessonId: string, done: number, total: number): Promise<number> {
    const pct = vodProgress(done, total);
    await this.ledger.setProgress(liveSessionId, pct).catch(() => undefined);
    await this.events.set(vodProgressKey(lessonId), String(pct), 'EX', 300).catch(() => undefined);
    return pct;
  }

  async progressOf(lessonId: string): Promise<number> {
    const raw = await this.events.get(vodProgressKey(lessonId)).catch(() => null);
    return raw === null ? 0 : Number(raw) || 0;
  }
}
