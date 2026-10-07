// SSOT Phase 044 §10 — contract tests (Zod, segmenter, ffmpeg, ledger, wiring)
// Run: npx tsx scripts/test-phase044-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HLS_SEGMENT_MAX_BYTES,
  HLS_SEGMENT_SECONDS,
  HlsVariantMetadataSchema,
  SubmitTranscodeJobSchema,
  TRANSCODE_POLL_MS,
  TRANSCODE_STAGE_WEIGHTS,
  TranscodeQualityEnum,
  TranscodeStatusEnum,
  VideoTranscodeJobSchema,
  lessonHlsPrefix,
  lessonMasterKey,
  lessonVariantPlaylist,
} from '../packages/shared/src/schemas/video-transcode.contract';
import {
  HlsSegmenterService,
  buildMasterPlaylist,
  buildVariantMetadata,
  validateMasterPlaylist,
  validateSegments,
} from '../apps/backend/src/modules/stream/hls-segmenter.service';
import { R2UploaderService } from '../apps/backend/src/infra/cloudflare/r2-uploader.service';
import { FFmpegTranscoderService, buildTranscode044Command, milestoneFor } from '../apps/backend/src/modules/stream/ffmpeg.service';
import { VideoTranscodeProcessor044 } from '../apps/backend/src/modules/stream/workers/video-transcode.processor';
import { TranscodeWorkerHost } from '../apps/backend/src/modules/stream/transcoder.worker';
import { TranscodeJobReaderService } from '../apps/backend/src/modules/stream/services/transcode-job-reader.service';
import { StreamService } from '../apps/backend/src/modules/stream/services/stream.service';
// NOTE: StreamModule/root controllers/resolvers carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§8)
// following the Phase 027–043 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '123e4567-e89b-12d3-a456-426614174000';
const JOB_ID = '223e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/keys ----------
{
  for (const q of ['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P']) {
    assert.equal(TranscodeQualityEnum.safeParse(q).success, true);
  }
  assert.equal(TranscodeQualityEnum.safeParse('RES_4K').success, false);
  for (const s of ['QUEUED', 'PROCESSING_UPLOAD', 'TRANSCODING', 'UPLOADING_R2', 'COMPLETED', 'FAILED']) {
    assert.equal(TranscodeStatusEnum.safeParse(s).success, true);
  }
  assert.equal(TranscodeStatusEnum.safeParse('READY').success, false);
  const job = {
    jobId: JOB_ID, lessonId: LESSON_ID, originalFileName: 'ep1.mp4', fileSizeBytes: 1024,
    durationSeconds: 600, status: 'QUEUED', progressPercentage: 0,
    masterPlaylistUrl: null, errorMessage: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  assert.equal(VideoTranscodeJobSchema.safeParse(job).success, true);
  assert.equal(VideoTranscodeJobSchema.safeParse({ ...job, progressPercentage: 101 }).success, false);
  assert.equal(VideoTranscodeJobSchema.safeParse({ ...job, masterPlaylistUrl: 'notaurl' }).success, false);

  const variant = {
    quality: 'RES_1080P', bandwidthBitsPerSec: 3000000, resolutionWidth: 1920,
    resolutionHeight: 1080, playlistFileName: 'prog-1080p.m3u8', chunkCount: 120, averageChunkSizeBytes: 1500000,
  };
  assert.equal(HlsVariantMetadataSchema.safeParse(variant).success, true);
  assert.equal(HlsVariantMetadataSchema.safeParse({ ...variant, averageChunkSizeBytes: 2097153 }).success, false);
  assert.equal(HlsVariantMetadataSchema.safeParse({ ...variant, chunkCount: 0 }).success, false);

  assert.equal(HLS_SEGMENT_MAX_BYTES, 2097152);
  assert.equal(HLS_SEGMENT_SECONDS, 4);
  assert.deepEqual(TRANSCODE_STAGE_WEIGHTS, { upload: 10, transcode: 60, r2sync: 30 });
  assert.equal(TRANSCODE_POLL_MS, 2000);
  assert.equal(lessonHlsPrefix('L'), 'courses/L/hls');
  assert.equal(lessonMasterKey('L'), 'courses/L/hls/master.m3u8');
  assert.equal(lessonVariantPlaylist('RES_720P'), 'prog-720p.m3u8');
  assert.equal(SubmitTranscodeJobSchema.safeParse({ lessonId: LESSON_ID, originalFileName: 'a.mp4', fileSizeBytes: 10, durationSeconds: 0, rawR2Key: 'raw/a' }).success, true);
  assert.equal(SubmitTranscodeJobSchema.safeParse({ lessonId: LESSON_ID, originalFileName: '', fileSizeBytes: 10, durationSeconds: 0, rawR2Key: 'raw/a' }).success, false);
  ok('Zod quality/status/job/variant verbatim + 2MB ceiling + stage weights + key layout');
}

// ---------- 2. Segmenter: RFC8216 + 2MB guard + metadata + master ----------
{
  assert.deepEqual(validateMasterPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nprog.m3u8\n'), { ok: true });
  assert.equal(validateMasterPlaylist('nota playlist').ok, false);
  assert.equal(validateMasterPlaylist('#EXTM3U\n').ok, false);
  assert.deepEqual(validateSegments([{ name: 'chunk_000.ts', sizeBytes: 2097152 }, { name: 'prog.m3u8', sizeBytes: 99 }]), { ok: true, violations: [] });
  const bad = validateSegments([{ name: 'chunk_000.ts', sizeBytes: 2097153 }, { name: 'chunk_001.ts', sizeBytes: 0 }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations.length, 2);

  const meta = buildVariantMetadata({
    quality: 'RES_720P', bandwidthBitsPerSec: 1500000, width: 1280, height: 720,
    playlistFileName: 'prog-720p.m3u8',
    segments: [{ name: 'a.ts', sizeBytes: 1000 }, { name: 'b.ts', sizeBytes: 3000 }],
  });
  assert.equal(HlsVariantMetadataSchema.safeParse(meta).success, true);
  assert.equal(meta.chunkCount, 2);
  assert.equal(meta.averageChunkSizeBytes, 2000);
  const empty = buildVariantMetadata({
    quality: 'RES_360P', bandwidthBitsPerSec: 400000, width: 640, height: 360,
    playlistFileName: 'prog-360p.m3u8', segments: [],
  });
  assert.equal(empty.chunkCount, 0); // Zod would reject zero-chunk rows — ledger skips them

  const master = buildMasterPlaylist([{ playlistFileName: 'prog-1080p.m3u8', bandwidthBitsPerSec: 3000000, width: 1920, height: 1080 }]);
  assert.equal(validateMasterPlaylist(master).ok, true);
  assert.ok(master.includes('RESOLUTION=1920x1080'));
  assert.ok(new HlsSegmenterService().validateSegments([{ name: 'x.ts', sizeBytes: 1 }]).ok);
  ok('Playlist/segment validators + variant stats + master builder');
}

// ---------- 3. §6.1 command shape + milestones ----------
{
  const cmd = buildTranscode044Command({ inputPath: '/tmp/in.mp4', outputDir: '/tmp/out', keyinfoPath: '/tmp/enc.keyinfo' });
  for (const t of ['split=4', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease', 'scale=w=640:h=360', '-b:v:0 3000k', '-b:v:3 400k', '-maxrate:v:0 3200k', '-preset slow', '-g 120', '-keyint_min 120', '-sc_threshold 0', '-hls_time 4', '-hls_key_info_file', 'chunk_%03d.ts', 'master.m3u8', 'var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3"', 'prog.m3u8']) {
    assert.ok(cmd.includes(t), `044 command missing ${t}`);
  }
  const noKey = buildTranscode044Command({ inputPath: '/tmp/in.mp4', outputDir: '/tmp/out', qualities: ['RES_360P'] });
  assert.ok(!noKey.includes('key_info') && noKey.includes('split=1'));
  assert.throws(() => buildTranscode044Command({ inputPath: 'x', outputDir: 'y', qualities: [] }), /No renditions/);
  const evil = buildTranscode044Command({ inputPath: '/tmp/a;b.mp4', outputDir: '/tmp/o' });
  assert.ok(evil.includes(`'/tmp/a;b.mp4'`));
  assert.equal(milestoneFor('upload'), 10);
  assert.equal(milestoneFor('transcode'), 70);
  assert.equal(milestoneFor('r2sync'), 95);
  assert.equal(milestoneFor('done'), 100);
  ok('044 ladder command verbatim + subset/escape guards + milestones');
}

function fakeLedger() {
  const calls: Array<{ status: string; pct: number }> = [];
  const completed: unknown[] = [];
  const failed: string[] = [];
  return {
    calls,
    completed,
    failed,
    ledger: {
      setProgress: async (_id: string, status: string, pct: number) => { calls.push({ status, pct }); },
      completeJob: async (_id: string, result: unknown) => { completed.push(result); },
      failJob: async (_id: string, message: string) => { failed.push(message); },
    },
  };
}

async function main(): Promise<void> {
  // ---------- 4. R2 uploader: bounded concurrency + keyed errors ----------
  {
    const puts: string[] = [];
    const uploader = new R2UploaderService({ putObjectBuffer: async (k: string) => { puts.push(k); if (k.includes('boom')) throw new Error('r2 down'); return {}; } });
    assert.equal(await uploader.uploadAll([{ key: 'a', body: Buffer.from('x'), contentType: 'video/MP2T' }, { key: 'b', body: Buffer.from('y'), contentType: 'video/MP2T' }], 1), 2);
    assert.deepEqual(puts, ['a', 'b']);
    await assert.rejects(() => uploader.uploadAll([{ key: 'boom', body: Buffer.from('x'), contentType: 'video/MP2T' }]), /R2 upload failed for boom/);
    await assert.rejects(() => uploader.uploadAll([]), /Nothing to upload/);
    await assert.rejects(() => new R2UploaderService().uploadAll([{ key: 'a', body: Buffer.from('x'), contentType: 't' }]), /unavailable/);
    ok('Uploader concurrency drain + keyed failure + empty/unwired guards');
  }

  // ---------- 5. FFmpeg lifecycle: milestones → validate → upload → ledger ----------
  {
    const { ledger, calls, completed, failed } = fakeLedger();
    const uploaded: string[] = [];
    const vault = { getObjectBuffer: async () => Buffer.from('mp4-bytes') };
    const uploader = new R2UploaderService({ putObjectBuffer: async (k: string) => { uploaded.push(k); return {}; } });
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const fakeExec = async (cmd: string) => {
      assert.ok(cmd.includes('-hls_time 4') && cmd.includes('3000k'));
      const m = /(\S+)\/%v\/prog\.m3u8/.exec(cmd);
      assert.ok(m, 'prog template present');
      const outDir = m[1].replace(/^'/, '').replace(/"$/, '');
      for (let v = 0; v < 4; v++) {
        await mkdir(join(outDir, String(v)), { recursive: true });
        await writeFile(join(outDir, String(v), 'prog.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunk_000.ts\n');
        await writeFile(join(outDir, String(v), 'chunk_000.ts'), Buffer.alloc(1000, 7));
      }
      await writeFile(join(outDir, 'master.m3u8'), '#EXTM3U\n');
    };
    const svc = new FFmpegTranscoderService(ledger as never, vault as never, uploader, fakeExec);
    const out = await svc.runLessonJob({ jobId: JOB_ID, lessonId: LESSON_ID, inputR2Key: 'raw/lesson.mp4', keyUri: '/api/v1/stream/key?jobId=x', publicBaseUrl: 'https://cdn.example.com' });
    assert.equal(out.variants, 4);
    assert.equal(out.masterPlaylistUrl, `https://cdn.example.com/${lessonMasterKey(LESSON_ID)}`);
    assert.deepEqual(calls.map((c) => c.status), ['PROCESSING_UPLOAD', 'TRANSCODING', 'UPLOADING_R2']);
    assert.equal(completed.length, 1);
    assert.equal(failed.length, 0);
    // %v-index layout: playlists live under {prefix}/{0..3}/prog.m3u8.
    const ledgerResult = completed[0] as { variants: Array<{ playlistPath: string }> };
    assert.ok(ledgerResult.variants[0].playlistPath.endsWith('/0/prog.m3u8'));
    assert.ok(ledgerResult.variants[3].playlistPath.endsWith('/3/prog.m3u8'));
    assert.ok(uploaded.some((k) => k.endsWith('/enc.key')));
    assert.ok(uploaded.some((k) => k.endsWith('master.m3u8')));

    // Oversize segment aborts before upload with FAILED ledger.
    const f2 = fakeLedger();
    const bigExec = async (cmd: string) => {
      const m = /(\S+)\/%v\/prog\.m3u8/.exec(cmd);
      assert.ok(m);
      const outDir = (m as RegExpExecArray)[1].replace(/^'/, '').replace(/"$/, '');
      for (let v = 0; v < 4; v++) {
        await mkdir(join(outDir, String(v)), { recursive: true });
        await writeFile(join(outDir, String(v), 'prog.m3u8'), '#EXTM3U\n');
        await writeFile(join(outDir, String(v), 'chunk_000.ts'), Buffer.alloc(HLS_SEGMENT_MAX_BYTES + 1, 7));
      }
      await writeFile(join(outDir, 'master.m3u8'), '#EXTM3U\n');
    };
    const svc2 = new FFmpegTranscoderService(f2.ledger as never, vault as never, uploader, bigExec);
    await assert.rejects(() => svc2.runLessonJob({ jobId: JOB_ID, lessonId: LESSON_ID, inputR2Key: 'raw/x.mp4', keyUri: 'k', publicBaseUrl: 'https://cdn.example.com' }), /Segment guard/);
    assert.equal(f2.failed.length, 1);

    // Unwired service fails closed.
    await assert.rejects(() => new FFmpegTranscoderService().runLessonJob({ jobId: JOB_ID, lessonId: LESSON_ID, inputR2Key: 'x', keyUri: 'k', publicBaseUrl: 'b' }), /unavailable/);
    ok('Lesson lifecycle milestones/validate/upload/ledger + oversize abort + fail-closed');
  }

  // ---------- 6. Worker submit + processor drain + reader ----------
  {
    const jobs = new Map<string, { id: string; lessonId: string; originalFileR2Path: string }>();
    const tables = {
      videoTranscodeJob: {
        upsert: async (a: unknown) => {
          const c = (a as { create: { lessonId: string; originalFileR2Path: string } }).create;
          const row = { id: JOB_ID, lessonId: c.lessonId, originalFileR2Path: c.originalFileR2Path };
          jobs.set(JOB_ID, row);
          return { id: JOB_ID };
        },
        findUnique: async (a: unknown) => {
          const id = (a as { where: { id: string } }).where.id;
          return jobs.get(id) ?? null;
        },
      },
    };
    const ran: string[] = [];
    const fakeFfmpeg = { runLessonJob: async (input: { jobId: string }) => { ran.push(input.jobId); return { masterPlaylistUrl: 'https://cdn/x/master.m3u8', variants: 4 }; } };
    const processor = new VideoTranscodeProcessor044({ findJob: async (id: string) => jobs.get(id) ?? null }, fakeFfmpeg as never);
    const executed: string[] = [];
    const host = new TranscodeWorkerHost(tables as never, { enqueue: (j: { jobId: string; run: () => Promise<void> }) => { void j.run().then(() => executed.push(j.jobId)); }, depth: 0 } as never, processor);
    const submitted = await host.submitLessonJob({ lessonId: LESSON_ID, originalFileName: 'ep1.mp4', fileSizeBytes: 100, durationSeconds: 60, rawR2Key: 'raw/lesson.mp4' });
    assert.equal(submitted.jobId, JOB_ID);
    assert.equal(submitted.queued, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(ran, [JOB_ID]);
    assert.deepEqual(executed, [JOB_ID]);

    await assert.rejects(() => processor.processLessonTranscode('missing'), /not found/);
    await assert.rejects(() => new VideoTranscodeProcessor044().processLessonTranscode(JOB_ID), /unavailable/);
    await assert.rejects(() => new TranscodeWorkerHost().submitLessonJob({ lessonId: LESSON_ID, originalFileName: 'x', fileSizeBytes: 1, durationSeconds: 0, rawR2Key: 'k' }), /unavailable/);

    const reader = new TranscodeJobReaderService({
      videoTranscodeJob: {
        findUnique: async () => ({
          id: JOB_ID, lessonId: LESSON_ID, status: 'COMPLETED', progressPercentage: 100,
          masterPlaylistUrl: 'https://cdn/x/master.m3u8', errorMessage: null,
          variants: [{ quality: 'RES_720P', totalChunks: 10, avgChunkSizeBytes: 1000 }],
        }),
      },
    } as never);
    const row = await reader.findJobWithVariants(JOB_ID);
    assert.equal(row?.status, 'COMPLETED');
    assert.equal(row?.variants.length, 1);
    assert.equal(await new TranscodeJobReaderService().findJobWithVariants(JOB_ID), null);
    ok('Worker submit→enqueue→drain + ghost/unwired guards + status reader');
  }

  // ---------- 7. Job-scoped DRM key gate (§8.1) ----------
  {
    const svc = new StreamService(
      {
        courseLesson: { findUnique: async () => ({ id: 'lesson-1', isPreview: false, section: { course: { productId: 'prod-1' } } }) },
        entitlement: { findUnique: async () => ({ userId: USER_ID }) },
        videoAsset: { findUnique: async () => null },
        videoKeyRotation: { findFirst: async () => null },
        user: { findUnique: async () => null },
        videoTranscodeJob: { findUnique: async () => ({ id: JOB_ID, lessonId: 'lesson-1', encryptionKeyPath: 'courses/lesson-1/hls/enc.key' }) },
      } as never,
      { presignedGetUrl: () => '', getObjectBuffer: async (k: string) => Buffer.from(`key-for:${k}`) } as never,
    );
    const key = await svc.getKeyByTranscodeJob(USER_ID, JOB_ID);
    assert.ok(key.toString().includes('courses/lesson-1/hls/enc.key'));

    const denied = new StreamService(
      {
        courseLesson: { findUnique: async () => ({ id: 'lesson-1', isPreview: false, section: { course: { productId: 'prod-1' } } }) },
        entitlement: { findUnique: async () => null },
        videoAsset: { findUnique: async () => null },
        videoKeyRotation: { findFirst: async () => null },
        user: { findUnique: async () => null },
        videoTranscodeJob: { findUnique: async () => ({ id: JOB_ID, lessonId: 'lesson-1', encryptionKeyPath: 'k' }) },
      } as never,
      { presignedGetUrl: () => '', getObjectBuffer: async () => Buffer.from('k') } as never,
    );
    await assert.rejects(() => denied.getKeyByTranscodeJob(USER_ID, JOB_ID), /สิทธิ์/);
    ok('Job key gate: entitled bytes, unentitled 403');
  }

  // ---------- 8. Wiring + SDL/component/proxy parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model VideoTranscodeJob', 'model VideoQualityVariant', 'enum TranscodeStatus', 'enum VideoQuality', '@@unique([transcodeJobId, quality])', 'lessonId           String          @unique']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['VideoTranscodeJobSchema', 'HlsVariantMetadataSchema', 'HLS_SEGMENT_MAX_BYTES', 'lessonHlsPrefix', 'SubmitTranscodeJobSchema']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/stream/stream.module.ts', 'utf8');
    for (const t of ['FFmpegTranscoderService', 'HlsSegmenterService', 'R2UploaderService', 'VideoTranscodeProcessor044', 'TranscodeWorkerHost', 'TranscodeJobReaderService', 'StreamTranscodeController', 'TranscodeKeyController', 'StreamJobResolver']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/stream/stream.controller.ts', 'utf8');
    for (const t of ['api/v1/stream/transcode', 'api/v1/stream/key', 'SubmitTranscodeJobSchema', 'getKeyByTranscodeJob', 'no-store']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const rslSrc = readFileSync('apps/backend/src/modules/stream/stream.resolver.ts', 'utf8');
    for (const t of ['getTranscodeJobStatus', 'TranscodeJobStatusPayload', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/stream-job.graphql/schema.graphql', 'utf8');
    assert.ok(sdl.includes('getTranscodeJobStatus') && sdl.includes('TranscodeJobStatusPayload'));
    const worker = readFileSync('apps/backend/src/modules/stream/transcoder.worker.ts', 'utf8');
    assert.ok(worker.includes('submitLessonJob') && worker.includes('VideoTranscodeQueue'));
    const r2up = readFileSync('apps/backend/src/infra/cloudflare/r2-uploader.service.ts', 'utf8');
    assert.ok(r2up.includes('uploadAll') && r2up.includes('putObjectBuffer'));
    const progress = readFileSync('apps/frontend/components/creator/video-upload-progress.tsx', 'utf8');
    for (const t of ['UPLOADING_PROCESSING', 'SUCCESS', 'ERROR', '/api/v1/stream/transcode', 'HlsVideoPlayer', 'role="progressbar"']) {
      assert.ok(progress.includes(t), `studio progress missing ${t}`);
    }
    assert.ok(!progress.includes("from 'hls.js'"), 'studio stays hls.js-free');
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/stream/transcode/route.ts', ['/api/v1/stream/transcode', 'POST']],
      ['apps/frontend/app/api/v1/stream/transcode/[jobId]/route.ts', ['/api/v1/stream/transcode/', 'jobId']],
      ['apps/frontend/app/api/v1/stream/key-by-job/route.ts', ['jobId', 'no-store']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Prisma jobs + barrel + module + gateway/key/resolver/SDL + worker/uploader + studio/proxies parity');
  }

  console.log(`\nPhase 044 contracts: ${passed} checks passed`);
}

void main();
