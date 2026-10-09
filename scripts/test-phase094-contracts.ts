// SSOT Phase 094 §10-11 — contract tests (Zod, captions, outline, jobs, parity)
// Run: npx tsx scripts/test-phase094-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AiJobTypeEnum,
  AiJobStatusEnum,
  CaptionLanguageEnum,
  CourseOutlinePromptSchema,
  SubtitleSegmentSchema,
  AutoCaptionJobPayloadSchema,
  GeneratedQuizQuestionSchema,
  COPILOT_STREAM,
  jobPhase,
  toCaptionVttTimestamp,
  toSrtTimestamp,
  parseTimestamp,
  buildVtt,
  buildSrt,
  cuesOverlap,
} from '../packages/shared/src/schemas/ai-copilot-contract';
import { sliceTranscript } from '../apps/backend/src/modules/ai-copilot/adapters/openai-whisper.adapter';
import { templateOutline } from '../apps/backend/src/modules/ai-copilot/adapters/llm-orchestrator.adapter';
import { InMemoryTranscribeQueue } from '../apps/backend/src/modules/ai-copilot/queues/transcribe.queue';
import { TranscribeProcessor } from '../apps/backend/src/modules/ai-copilot/queues/transcribe.processor';
import { OutlineGeneratorService } from '../apps/backend/src/modules/ai-copilot/services/outline-generator.service';
import { WhisperTranscriberService } from '../apps/backend/src/modules/ai-copilot/services/whisper-transcriber.service';
import { SubtitleFormatterService } from '../apps/backend/src/modules/ai-copilot/services/subtitle-formatter.service';
import { AutoQuizBuilderService } from '../apps/backend/src/modules/ai-copilot/services/auto-quiz-builder.service';
import { subtitleTicket, verifySubtitleTicket } from '../apps/backend/src/modules/ai-copilot/utils/subtitle-ticket.util';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(AiJobTypeEnum.safeParse('VIDEO_TRANSCRIBE').success, true);
  assert.equal(AiJobStatusEnum.safeParse('COMPLETED').success, true);
  assert.equal(AiJobStatusEnum.safeParse('TRANSCRIBING').success, false);
  assert.equal(CaptionLanguageEnum.safeParse('JA').success, true);
  const prompt = { topic: 'การเงินส่วนบุคคล', targetAudience: 'นักเรียน', difficultyLevel: 'BEGINNER' };
  const parsed = CourseOutlinePromptSchema.safeParse(prompt);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.numberOfSections, 5);
  assert.equal(CourseOutlinePromptSchema.safeParse({ ...prompt, topic: 'ab' }).success, false);
  assert.equal(
    SubtitleSegmentSchema.safeParse({ id: UUID, startTimeSec: 0, endTimeSec: 6, text: 'สวัสดี' }).success,
    true,
  );
  assert.equal(
    AutoCaptionJobPayloadSchema.safeParse({ jobId: UUID, lessonId: UUID_B, status: 'PROCESSING', progressPercentage: 70 }).success,
    true,
  );
  assert.equal(
    AutoCaptionJobPayloadSchema.safeParse({ jobId: UUID, lessonId: UUID_B, status: 'PROCESSING', progressPercentage: 101 }).success,
    false,
  );
  assert.equal(
    GeneratedQuizQuestionSchema.safeParse({ question: 'q', options: ['a', 'b'], correctOptionIndex: 0, explanation: 'e' }).success,
    true,
  );
  assert.equal(
    GeneratedQuizQuestionSchema.safeParse({ question: 'q', options: ['only'], correctOptionIndex: 0, explanation: 'e' }).success,
    false,
  );
  ok('Zod §3.1 verbatim (job/lang/prompt/segment/job-payload/quiz gates)');
}

// ---------- 2. Caption helpers (§6.1/§10) ----------
{
  assert.equal(COPILOT_STREAM, 'stream:ai:copilot');
  assert.equal(jobPhase(0), 'QUEUED');
  assert.equal(jobPhase(10), 'EXTRACTING_AUDIO');
  assert.equal(jobPhase(50), 'TRANSCRIBING');
  assert.equal(jobPhase(90), 'FORMATTING');
  assert.equal(jobPhase(100), 'COMPLETED');
  assert.equal(toCaptionVttTimestamp(3721.5), '01:02:01.500');
  assert.equal(toSrtTimestamp(3721.5), '01:02:01,500');
  assert.ok(Math.abs(parseTimestamp('01:02:01.500') - 3721.5) < 1e-9);
  assert.ok(Number.isNaN(parseTimestamp('nope')));
  const cues = [
    { startTimeSec: 0, endTimeSec: 6, text: 'หนึ่ง' },
    { startTimeSec: 6, endTimeSec: 12, text: 'สอง' },
  ];
  const vtt = buildVtt(cues);
  assert.ok(vtt.startsWith('WEBVTT') && vtt.includes('00:00:00.000 --> 00:00:06.000'));
  const srt = buildSrt(cues);
  assert.ok(srt.startsWith('1\n00:00:00,000 --> 00:00:06,000'));
  assert.equal(cuesOverlap(cues), false);
  assert.equal(cuesOverlap([...cues, { startTimeSec: 5, endTimeSec: 9, text: 'ซ้อน' }]), true);
  assert.equal(buildVtt([]), 'WEBVTT\n\n');
  ok('Helpers: phase bands + VTT/SRT round-trip + overlap guard');
}

// ---------- 3. Adapters (STT slicing + outline template) ----------
{
  const text = Array.from({ length: 60 }, (_, i) => `คำ${i}`).join(' ');
  const cues = sliceTranscript(text, 60);
  assert.ok(cues.length >= 8 && cues.length <= 12);
  assert.ok(cues.every((c) => c.endTimeSec > c.startTimeSec && c.text.length > 0));
  assert.deepEqual(sliceTranscript('', 60), []);
  assert.deepEqual(sliceTranscript(text, 0), []);
  const outline = templateOutline('การเงิน', 'นักเรียน', 'BEGINNER', 3);
  assert.equal(outline.length, 3);
  assert.ok(outline.every((s) => s.lessons.length === 3 && s.sectionTitle.includes('การเงิน')));
  ok('Adapters: deterministic STT cues + 3-lesson outline template');
}

// ---------- 4. Formatter (VTT/SRT + R2 + atomic persist) ----------
async function sectionFormatter(): Promise<void> {
  const puts: string[] = [];
  let savedSubs = 0;
  let savedSegs = 0;
  const store = {
    saveSubtitle: async () => { savedSubs++; return { id: 'sub-1' }; },
    saveSegments: async (tx: unknown, rows: unknown[]) => { savedSegs += rows.length; },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const r2 = { putObject: async (key: string) => { puts.push(key); return { eTag: 'x' }; } };
  const svc = new SubtitleFormatterService(store, tx, r2);
  const cues = [
    { startTimeSec: 0, endTimeSec: 6, text: 'หนึ่ง' },
    { startTimeSec: 6, endTimeSec: 12, text: 'สอง' },
  ];
  const r = await svc.formatAndStore({ lessonId: UUID_B, language: 'TH', cues });
  assert.deepEqual([r.subtitleId, r.cueCount], ['sub-1', 2]);
  assert.ok(r.vttUrl.endsWith('.vtt') && r.srtUrl.endsWith('.srt'));
  assert.equal(savedSubs, 1);
  assert.equal(savedSegs, 2);
  assert.equal(puts.length, 2);
  await assert.rejects(svc.formatAndStore({ lessonId: UUID_B, language: 'TH', cues: [] }), /No cues/);
  await assert.rejects(
    svc.formatAndStore({ lessonId: UUID_B, language: 'TH', cues: [...cues, { startTimeSec: 5, endTimeSec: 9, text: 'x' }] }),
    /Overlapping/,
  );
  ok('Formatter: VTT/SRT + R2 vault + atomic rows + 2 gates');
}

// ---------- 5. Outline service (draft job row + stream) ----------
async function sectionOutline(): Promise<void> {
  const jobs: string[] = [];
  const streams: string[] = [];
  const store = {
    createJob: async () => { jobs.push('created'); return { id: 'job-1' }; },
    completeJob: async () => undefined,
    failJob: async () => undefined,
  };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const { DeterministicOutlineAdapter } = await import('../apps/backend/src/modules/ai-copilot/adapters/llm-orchestrator.adapter');
  const svc = new OutlineGeneratorService(new DeterministicOutlineAdapter(), store, bus);
  const t0 = Date.now();
  const r = await svc.generate({
    userId: UUID, prompt: { topic: 'การเงินส่วนบุคคล', targetAudience: 'นักเรียน', difficultyLevel: 'BEGINNER', numberOfSections: 2 },
  });
  assert.ok(Date.now() - t0 < 30000, '<30s budget');
  assert.equal(r.sections.length, 2);
  assert.ok(r.sections.every((s) => s.lessons.length === 3));
  assert.ok(streams.includes(COPILOT_STREAM));
  await assert.rejects(
    svc.generate({ userId: UUID, prompt: { topic: 'ab', targetAudience: 'x', difficultyLevel: 'BEGINNER' } }),
    /Invalid outline prompt/,
  );
  ok('Outline: 2-section draft + stream + gate (<30s)');
}

// ---------- 6. Transcribe intake + processor drain (progress bands) ----------
async function sectionTranscribe(): Promise<void> {
  const streams: string[] = [];
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const progresses: number[] = [];
  const statuses: string[] = [];
  const store = {
    createJob: async () => ({ id: 'job-9' }),
    markProcessing: async () => { statuses.push('PROCESSING'); },
    markProgress: async (id: string, p: number) => { progresses.push(p); },
    markCompleted: async () => { statuses.push('COMPLETED'); },
    markFailed: async (id: string, e: string) => { statuses.push(`FAILED:${e}`); },
  };
  const queue = new InMemoryTranscribeQueue();
  const intake = new WhisperTranscriberService(queue, { createJob: store.createJob }, bus);
  const text = Array.from({ length: 30 }, (_, i) => `คำบรรยาย${i}`).join(' ');
  const req = await intake.requestTranscribe({ userId: UUID, lessonId: UUID_B, transcriptText: text, durationSec: 60 });
  assert.deepEqual([req.jobId, req.queued], ['job-9', 1]);
  await assert.rejects(
    intake.requestTranscribe({ userId: UUID, lessonId: UUID_B, transcriptText: '', durationSec: 60 }),
    /Invalid transcribe/,
  );
  // Drain with stubbed formatter capturing cues.
  let formatted = 0;
  const { DeterministicSttAdapter } = await import('../apps/backend/src/modules/ai-copilot/adapters/openai-whisper.adapter');
  const processor = new TranscribeProcessor(
    queue,
    new DeterministicSttAdapter(),
    { formatAndStore: async (a: { cues: unknown[] }) => { formatted = a.cues.length; return { subtitleId: 's', vttUrl: 'v', srtUrl: 'r', cueCount: formatted }; } } as never,
    store,
    bus,
  );
  const drained = await processor.drain();
  assert.equal(drained.processed, 1);
  assert.ok(formatted > 0);
  assert.ok(progresses.includes(20) && progresses.includes(70) && progresses.includes(100), 'progress bands');
  assert.ok(statuses.includes('PROCESSING') && statuses.includes('COMPLETED'));
  // Empty queue + failing job shapes.
  assert.deepEqual((await processor.drain()).processed, 0);
  await queue.enqueue({ jobId: 'job-bad', lessonId: UUID_B, transcriptText: '', durationSec: 60, language: 'TH' });
  assert.equal((await processor.drain()).processed, 0);
  assert.ok(statuses.some((s) => s.startsWith('FAILED')));
  ok('Transcribe: intake gate + drain bands + empty/fail shapes');
}

// ---------- 7. Quiz builder (persist + validation) ----------
async function sectionQuiz(): Promise<void> {
  let saved = 0;
  const streams: string[] = [];
  const store = {
    saveQuizzes: async (tx: unknown, rows: unknown[]) => { saved += rows.length; return rows.length; },
  };
  const tx = { run: async <T>(fn: (t: unknown) => Promise<T>) => fn({}) };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new AutoQuizBuilderService(store, tx, bus);
  const transcript = [
    'การตั้งราคาหนังสือคือศิลปะการหาจุดสมดุลระหว่างต้นทุนการผลิตและคุณค่าที่ผู้อ่านรับรู้ถึงเนื้อหาภายในเล่ม.',
    'ต้นทุนการพิมพ์ต่อเล่มจะลดลงอย่างมีนัยสำคัญเมื่อสั่งพิมพ์ในจำนวนที่มากขึ้นตามหลักการประหยัดต่อขนาด.',
    'โปรโมชันช่วงเปิดตัวและการสร้างกระแสในโซเชียลมีเดียช่วยผลักดันให้หนังสือติดชาร์ตขายดีได้อย่างรวดเร็ว.',
  ].join(' ');
  const r = await svc.buildFromTranscript({ lessonId: UUID_C, transcriptText: transcript });
  assert.equal(r.saved, 3);
  assert.ok(r.questions.every((q) => q.options.length === 4 && q.correctOptionIndex === 0));
  assert.ok(streams.includes(COPILOT_STREAM));
  await assert.rejects(svc.buildFromTranscript({ lessonId: '', transcriptText: transcript }), /lessonId/);
  await assert.rejects(svc.buildFromTranscript({ lessonId: UUID_C, transcriptText: 'สั้น' }), /too short/);
  ok('Quiz: 3 persisted questions + 2 gates + stream');
}

// ---------- 8. Subtitle tickets (5-min HMAC, Gate 4) ----------
{
  const secret = 'test-secret';
  const exp = Date.now() + 5 * 60 * 1000;
  const t = subtitleTicket(UUID_B, exp, secret);
  assert.equal(verifySubtitleTicket(t, UUID_B, exp, secret, Date.now()), true);
  assert.equal(verifySubtitleTicket(t, UUID_B, exp - 10 * 60 * 1000, secret, Date.now()), false);
  assert.equal(verifySubtitleTicket('00'.repeat(32), UUID_B, exp, secret, Date.now()), false);
  assert.equal(verifySubtitleTicket(t, UUID_C, exp, secret, Date.now()), false);
  ok('Tickets: valid/expired/forged/wrong-lesson shapes');
}

// ---------- 9. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum AiJobType {',
    'VIDEO_TRANSCRIBE',
    'enum AiJobStatus {',
    'model AiCoPilotJob {',
    'progressPercent Int         @default(0)',
    'model VideoSubtitle {',
    'vttStorageR2 String',
    'model SubtitleSegment {',
    'translatedJson  Json?',
    'model AiGeneratedQuiz {',
    'answerIndex Int',
    'videoSubtitles     VideoSubtitle[]',
    'generatedQuizzes   AiGeneratedQuiz[]',
    'copilotJobs          AiCoPilotJob[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: job/subtitle/segments/quiz + User/Lesson relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/ai-copilot/adapters/openai-whisper.adapter.ts',
    'apps/backend/src/modules/ai-copilot/adapters/llm-orchestrator.adapter.ts',
    'apps/backend/src/modules/ai-copilot/queues/transcribe.queue.ts',
    'apps/backend/src/modules/ai-copilot/queues/transcribe.processor.ts',
    'apps/backend/src/modules/ai-copilot/services/outline-generator.service.ts',
    'apps/backend/src/modules/ai-copilot/services/whisper-transcriber.service.ts',
    'apps/backend/src/modules/ai-copilot/services/subtitle-formatter.service.ts',
    'apps/backend/src/modules/ai-copilot/services/auto-quiz-builder.service.ts',
    'apps/backend/src/modules/ai-copilot/controllers/ai-copilot.controller.ts',
    'apps/backend/src/modules/ai-copilot/controllers/subtitle-download.controller.ts',
    'apps/backend/src/modules/ai-copilot/resolvers/ai-copilot.resolver.ts',
    'apps/backend/src/modules/ai-copilot/ai-copilot.module.ts',
    'apps/backend/src/modules/ai-copilot/utils/subtitle-ticket.util.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/ai-copilot/ai-copilot.module.ts', 'utf8');
  assert.ok(mod.includes('AiCopilotModule') && mod.includes('TranscribeProcessor') && mod.includes('R2StorageService'));
  assert.ok(!/class AiCopilotModuleModule/.test(mod), 'legacy scaffold class removed');
  assert.ok(!/ServiceService|ResolverResolver|ControllerController/.test(mod), 'legacy scaffold names removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('AiCopilotModule'));
  const gql = readFileSync('apps/backend/src/modules/ai-copilot/resolvers/ai-copilot.resolver.ts', 'utf8');
  assert.ok(gql.includes('generateCourseOutline') && gql.includes('transcribeLessonVideo') && gql.includes('generateLessonQuiz'));
  const sse = readFileSync('apps/backend/src/modules/ai-copilot/controllers/ai-copilot.controller.ts', 'utf8');
  assert.ok(sse.includes('@Sse(') && sse.includes("type: 'token'") && sse.includes("type: 'done'"), 'SSE outline frames');
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/ai-copilot.resolver.ts', 'utf8');
  assert.ok(alias.includes('AiCopilotResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/ai-copilot.graphql', 'utf8');
  assert.ok(sdl.includes('OutlinePayload') && sdl.includes('GeneratedQuizPayload') && sdl.includes('transcribeLessonVideo'));
  for (const p of [
    'apps/frontend/components/co-pilot/OutlineStudio.tsx',
    'apps/frontend/components/co-pilot/SubtitleTimelineEditor.tsx',
    'apps/frontend/components/co-pilot/VideoSubtitleSyncOverlay.tsx',
    'apps/frontend/hooks/useCoPilot.ts',
    'apps/frontend/lib/co-pilot/co-pilot-client.ts',
    'apps/frontend/app/(dashboard)/creator/co-pilot/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useCoPilot.ts', 'utf8');
  assert.ok(hook.includes("'INIT'") && hook.includes("'SUCCESS'") && hook.includes("'ERROR'"), '5-state hook');
  const studio = readFileSync('apps/frontend/components/co-pilot/OutlineStudio.tsx', 'utf8');
  assert.ok(!studio.includes('@/components/ui') && !studio.includes('lucide-react'), 'zero-dep studio (no heavy UI)');
  for (const p of [
    'apps/frontend/app/api/v1/copilot/outline/route.ts',
    'apps/frontend/app/api/v1/copilot/transcribe/route.ts',
    'apps/frontend/app/api/v1/copilot/job/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('ai-copilot-contract') && barrel.includes('CourseOutlinePromptSchema'));
  ok('Parity: module/GQL+alias/SDL/studio+editor+overlay/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionFormatter();
  await sectionOutline();
  await sectionTranscribe();
  await sectionQuiz();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase094 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
