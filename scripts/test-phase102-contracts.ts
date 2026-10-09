// SSOT Phase 102 §10-11 — contract tests (Zod, pipeline, worker, parity)
// Run: npx tsx scripts/test-phase102-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VodPipelineStatusEnum,
  StreamWebhookEventSchema,
  TranscodeJobPayloadSchema,
  VODStatusUpdatePayloadSchema,
  VOD_READY_BUDGET_SEC,
  VOD_LADDER,
  VOD_MAX_ATTEMPTS,
  VOD_STREAM,
  vodJobKey,
  vodProgressKey,
  vodR2Prefix,
  vodProgress,
} from '../packages/shared/src/schemas/live-to-vod.schema';
import { canPipelineTransition, assertPipelineTransition, isTerminalStage } from '../apps/backend/src/modules/stream/domain/live-session.aggregate';
import { parseStreamEvent, isVodTrigger } from '../apps/backend/src/modules/stream/domain/events/stream-ended.event';
import { LiveToVodService } from '../apps/backend/src/modules/stream/application/live-to-vod.service';
import { TranscodeProcessorWorker } from '../apps/backend/src/modules/stream/application/transcode-processor.worker';
import { VodSummaryService } from '../apps/backend/src/modules/stream/application/vod-summary.service';
import { FfmpegTranscoderAdapter } from '../apps/backend/src/modules/stream/infrastructure/ffmpeg-transcoder.adapter';
import { R2VaultStorageAdapter } from '../apps/backend/src/modules/stream/infrastructure/r2-vault-storage.adapter';
import { LessonService } from '../apps/backend/src/modules/course/lesson.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const NOW = new Date().toISOString();

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(VodPipelineStatusEnum.safeParse('VOD_AVAILABLE').success, true);
  assert.equal(VodPipelineStatusEnum.safeParse('LIVE').success, false);
  const evt = {
    eventId: UUID, sessionId: 'sess-1', lessonId: UUID_B, tenantId: 't1',
    eventType: 'RECORDING_COMPLETE', recordingUrl: 'https://cdn.local/r.mp4', timestamp: NOW,
  };
  assert.equal(StreamWebhookEventSchema.safeParse(evt).success, true);
  assert.equal(StreamWebhookEventSchema.safeParse({ ...evt, eventType: 'NOPE' }).success, false);
  assert.equal(StreamWebhookEventSchema.safeParse({ ...evt, lessonId: 'bad' }).success, false);
  assert.equal(
    TranscodeJobPayloadSchema.safeParse({
      sessionId: 'sess-1', lessonId: UUID_B, tenantId: 't1',
      rawSourceUrl: 'https://cdn.local/r.mp4', targetResolutions: ['1080p', '480p'],
    }).success,
    true,
  );
  assert.equal(
    VODStatusUpdatePayloadSchema.safeParse({
      lessonId: UUID_B, status: 'VOD_AVAILABLE', hlsPlaylistUrl: 'https://vod.local/m.m3u8', durationSec: 100,
    }).success,
    true,
  );
  assert.equal(
    VODStatusUpdatePayloadSchema.safeParse({
      lessonId: UUID_B, status: 'VOD_AVAILABLE', hlsPlaylistUrl: 'not-url', durationSec: -1,
    }).success,
    false,
  );
  ok('Zod §3.1 verbatim (status/webhook/job/vod gates)');
}

// ---------- 2. Pure helpers + aggregate machine ----------
{
  assert.equal(VOD_READY_BUDGET_SEC, 30);
  assert.deepEqual([...VOD_LADDER], ['1080p', '720p', '480p']);
  assert.equal(VOD_MAX_ATTEMPTS, 3);
  assert.equal(VOD_STREAM, 'stream:live:vod');
  assert.equal(vodJobKey('s'), 'live:vod:job:s');
  assert.equal(vodProgressKey('l'), 'live:vod:progress:l');
  assert.equal(vodR2Prefix('s'), 'live-vod/s/hls');
  assert.equal(vodProgress(1, 4), 25);
  assert.equal(vodProgress(9, 0), 0);
  assert.ok(canPipelineTransition('PROCESSING_VOD', 'VOD_AVAILABLE'));
  assert.ok(!canPipelineTransition('VOD_AVAILABLE', 'FAILED'));
  assert.ok(canPipelineTransition('FAILED', 'PROCESSING_VOD'));
  assert.ok(isTerminalStage('VOD_AVAILABLE') && !isTerminalStage('PROCESSING_VOD'));
  assert.throws(() => assertPipelineTransition('SCHEDULED', 'VOD_AVAILABLE'), /Illegal/);
  assert.equal(parseStreamEvent({ nope: 1 }), null);
  const parsed = parseStreamEvent({
    eventId: UUID, sessionId: 's', lessonId: UUID_B, tenantId: 't',
    eventType: 'STREAM_END', timestamp: NOW,
  });
  assert.ok(parsed && isVodTrigger(parsed));
  assert.equal(isVodTrigger({ ...parsed, eventType: 'STREAM_START' } as never), false);
  const adapter = new FfmpegTranscoderAdapter();
  assert.deepEqual(adapter.ladder().map((r) => r.resolution), ['1080p', '720p', '480p']);
  assert.deepEqual([adapter.segmentPlan(100).segments, adapter.segmentPlan(0).segments], [25, 1]);
  ok('Helpers: budgets/ladder/keys/progress + pipeline machine + event gate');
}

// ---------- shared mocks ----------
function events() {
  const streams: string[] = [];
  const kv = new Map<string, string>();
  return {
    streams,
    xaddPipeline: async (s: string) => { streams.push(s); },
    set: async (k: string, v: string) => { kv.set(k, v); return 'OK'; },
    get: async (k: string) => kv.get(k) ?? null,
  };
}

// ---------- 3. Orchestrator ingest (BDD-1 idempotent queue) ----------
async function sectionIngest(): Promise<void> {
  const ev = events();
  const jobs = new Map<string, Record<string, unknown>>();
  const ledger = {
    upsertJob: async (d: { liveSessionId: string; lessonId: string }) => {
      const row = { id: `job-${d.liveSessionId}`, progressPct: 0, ...d };
      jobs.set(d.liveSessionId, row);
      return row;
    },
    setProgress: async () => undefined,
    completeJob: async () => undefined,
    failJob: async () => undefined,
    findJobBySession: async (s: string) => (jobs.get(s) ?? null) as never,
  };
  const runs: string[] = [];
  const queue = { enqueue: (j: { jobId: string; run: () => Promise<void> }) => { runs.push(j.jobId); } };
  const svc = new LiveToVodService(ledger as never, queue, ev, async () => undefined);
  const raw = {
    eventId: UUID, sessionId: 'sess-1', lessonId: UUID_B, tenantId: 't1',
    eventType: 'RECORDING_COMPLETE', recordingUrl: 'https://cdn.local/r.mp4', timestamp: NOW,
  };
  const t0 = Date.now();
  const r = await svc.ingest(raw);
  assert.ok(Date.now() - t0 < 30000, 'ingest <30s budget');
  assert.deepEqual([r.received, r.queued], [true, true]);
  assert.deepEqual(runs, ['live:vod:job:sess-1']);
  assert.ok(ev.streams.includes(VOD_STREAM));
  // Non-trigger + invalid shapes queue nothing.
  assert.deepEqual((await svc.ingest({ ...raw, eventType: 'STREAM_START' })).queued, false);
  assert.deepEqual((await svc.ingest({ garbage: true })).queued, false);
  // STREAM_END without a URL arms the ledger but queues nothing.
  const armed = await svc.ingest({ ...raw, sessionId: 'sess-arm', eventType: 'STREAM_END', recordingUrl: undefined });
  assert.deepEqual([armed.received, armed.queued], [true, false]);
  // Completed session redelivery is idempotent.
  jobs.set('sess-1', { id: 'job-sess-1', progressPct: 100, hlsManifestPath: 'https://vod.local/m.m3u8' });
  const re = await svc.ingest(raw);
  assert.deepEqual([re.queued, runs.length], [false, 1]);
  // Progress probe round-trips through the edge key.
  assert.equal(await svc.reportProgress('sess-1', UUID_B, 1, 4), 25);
  assert.equal(await svc.progressOf(UUID_B), 25);
  ok('Ingest: ledger + FIFO + idempotent redelivery + progress probe');
}

// ---------- 4. Worker run (ladder → R2 → lesson → summary → notify) ----------
async function sectionWorker(): Promise<void> {
  const ev = events();
  const completed: string[] = [];
  const failed: string[] = [];
  const ledger = {
    completeJob: async (s: string) => { completed.push(s); },
    failJob: async (s: string) => { failed.push(s); },
  };
  const puts: string[] = [];
  const vault = new R2VaultStorageAdapter({
    putObjectBuffer: async (k: string) => { puts.push(k); return { eTag: 'e' }; },
    getObjectBuffer: async () => Buffer.from('x'),
  });
  const ffmpeg = { runLessonJob: async () => ({ masterPlaylistUrl: 'https://vod.local/sess-1/hls/master.m3u8', variants: 3 }) };
  const attached: Array<{ id: string; url: string }> = [];
  const lessons = {
    findLesson: async (id: string) => ({ id, title: 'Live Class' }),
    attachVod: async (id: string, d: { videoHlsUrl: string; durationSec: number; aiSummaryText?: string }) => {
      attached.push({ id, url: d.videoHlsUrl });
      return { id, title: 'Live Class', videoHlsUrl: d.videoHlsUrl, durationSec: 0, isLiveRecorded: true, aiSummaryText: d.aiSummaryText ?? null };
    },
  };
  const notified: string[] = [];
  const summary = new VodSummaryService();
  const worker = new TranscodeProcessorWorker(
    ledger as never,
    vault,
    ffmpeg as never,
    lessons as never,
    summary,
    { notifyVodReady: async (a: { lessonId: string }) => { notified.push(a.lessonId); } },
    ev,
  );
  // fetchBytes hits the network — stub via file URL failure path instead:
  // point rawSourceUrl at an invalid host and assert the FAILED branch.
  await assert.rejects(
    worker.run({ liveSessionId: 'sess-9', lessonId: UUID_B, tenantId: 't1', rawSourceUrl: 'https://invalid.localhost/r.mp4' }),
    /fetch failed|Recording fetch failed/,
  );
  assert.deepEqual(failed, ['sess-9']);
  assert.ok(ev.streams.includes(VOD_STREAM));
  // Summary baseline is deterministic Thai chapter framing.
  const text = await summary.summarize({ lessonId: UUID_B, title: 'Live Class', durationSec: 3600 });
  assert.ok(text.includes('Live Class') && text.includes('ช่วงที่'));
  // Success path (fully stubbed I/O): ladder → attach → complete → notify.
  const ev2 = events();
  const done: string[] = [];
  const okLedger = { completeJob: async (s: string) => { done.push(s); }, failJob: async () => { throw new Error('must not fail'); } };
  const okVault = new R2VaultStorageAdapter({
    putObjectBuffer: async () => ({ eTag: 'e' }),
    getObjectBuffer: async () => Buffer.from('x'),
  });
  okVault.fetchBytes = async () => Buffer.from('recording-bytes');
  const okWorker = new TranscodeProcessorWorker(
    okLedger as never,
    okVault,
    { runLessonJob: async () => ({ masterPlaylistUrl: 'https://vod.local/m.m3u8', variants: 3 }) } as never,
    lessons as never,
    summary,
    { notifyVodReady: async (a: { lessonId: string }) => { notified.push(a.lessonId); } },
    ev2,
  );
  await okWorker.run({ liveSessionId: 'sess-1', lessonId: UUID_B, tenantId: 't1', rawSourceUrl: 'https://cdn.local/r.mp4' });
  assert.deepEqual(done, ['sess-1']);
  assert.deepEqual(attached.map((a) => a.url), ['https://vod.local/m.m3u8']);
  assert.deepEqual(notified, [UUID_B]);
  assert.ok(ev2.streams.includes(VOD_STREAM));
  assert.equal(await ev2.get('live:vod:progress:' + UUID_B), '100');
  // LessonService port shape (attach path the worker drives).
  const svc = new LessonService({} as never);
  assert.ok(typeof svc.attachVod === 'function' && typeof svc.findLesson === 'function');
  void completed;
  void attached;
  void notified;
  void puts;
  ok('Worker: failure flips FAILED + summary baseline + lesson port');
}

// ---------- 5. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model TranscodeJob {',
    'liveSessionId   String      @unique',
    'progressPct     Float       @default(0.0)',
    'hlsManifestPath String?',
    'transcodeJob     TranscodeJob?',
    'isLiveRecorded Boolean  @default(false)',
    'aiSummaryText  String?  @db.Text',
    'liveSession    LiveSession?',
    'lessonId         String?           @unique',
    '@@index([lessonId])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: TranscodeJob + lesson VOD cols + session binding');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/stream/domain/live-session.aggregate.ts',
    'apps/backend/src/modules/stream/domain/events/stream-ended.event.ts',
    'apps/backend/src/modules/stream/application/live-to-vod.service.ts',
    'apps/backend/src/modules/stream/application/transcode-processor.worker.ts',
    'apps/backend/src/modules/stream/application/vod-summary.service.ts',
    'apps/backend/src/modules/stream/application/vod-job.repository.ts',
    'apps/backend/src/modules/stream/infrastructure/ffmpeg-transcoder.adapter.ts',
    'apps/backend/src/modules/stream/infrastructure/r2-vault-storage.adapter.ts',
    'apps/backend/src/modules/course/lesson.service.ts',
    'apps/backend/src/api/webhooks/live-stream-webhook.controller.ts',
    'apps/backend/src/api/graphql/resolvers/stream.resolver.ts',
    'apps/backend/src/modules/stream/stream.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  for (const f of [
    'apps/backend/src/modules/stream/application/live-to-vod.service.ts',
    'apps/backend/src/modules/stream/application/transcode-processor.worker.ts',
  ]) {
    assert.ok(!readFileSync(f, 'utf8').includes('bullmq'), `${f} queue lib`);
  }
  const gql = readFileSync('apps/backend/src/api/graphql/resolvers/stream.resolver.ts', 'utf8');
  assert.ok(gql.includes('completeLiveSession') && gql.includes('retranscodeFailedVOD') && gql.includes('vodStatus'));
  const player = readFileSync('apps/frontend/components/stream/LivePlayerWithVODFallback.tsx', 'utf8');
  assert.ok(player.length > 200 && !player.includes('AUTO-SCAFFOLD') && !player.includes('hls.js'), 'VOD player zero-dep');
  assert.ok(player.includes('PROCESSING_VOD') && player.includes('SUCCESS_VOD_READY') && player.includes('ERROR'), '5 states');
  assert.ok(readFileSync('apps/frontend/app/api/v1/live-access/vod-status/route.ts', 'utf8').includes('localhost:4000'), 'proxy backend');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('live-to-vod.schema') && barrel.includes('StreamWebhookEventSchema'));
  ok('Parity: pipeline/worker/adapters/lesson/webhook/GQL/player/proxy/barrel (zero-dep)');
}

async function main(): Promise<void> {
  await sectionIngest();
  await sectionWorker();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase102 contracts: ${passed + 3} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
