// SSOT Phase 043 §10 — contract tests (Zod, queue, crypto, ffmpeg, services, wiring)
// Run: npx tsx scripts/test-phase043-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  HlsManifestStreamPayloadSchema,
  InitiateUploadSchema,
  VIDEO_PROGRESS_SYNC_SEC,
  VIDEO_RAM_BUDGET_MB,
  VIDEO_RENDITION_LADDER,
  VIDEO_TOKEN_TTL_SEC,
  VIDEO_UPLOAD_PART_BYTES,
  VideoProgressReportSchema,
  VideoResolutionEnum,
  VideoStatusEnum,
  VideoTranscodeJobPayloadSchema,
  hlsMasterKey,
  hlsOutputPrefix,
  hlsVariantKey,
  rawVideoPartKey,
  rawVideoPrefix,
} from '../packages/shared/src/schemas/video-pipeline-contract';
import { VideoTranscodeQueue, transcodeBackoffMs } from '../apps/backend/src/jobs/transcoder/video-transcode.queue';
import { generateAes128Key, keyFileBytes, keyinfoFile } from '../apps/backend/src/jobs/transcoder/hls-encryptor';
import { buildFfmpegCommand } from '../apps/backend/src/jobs/transcoder/ffmpeg-command';
import { buildWatermarkFilter } from '../apps/backend/src/jobs/transcoder/watermark-injector';
import { FfmpegWorkerProcessor, partCountFor } from '../apps/backend/src/jobs/transcoder/ffmpeg-worker.processor';
import { VideoUploadService } from '../apps/backend/src/modules/stream/services/video-upload.service';
import { StreamService, videoProgressKey } from '../apps/backend/src/modules/stream/services/stream.service';
import workerRouter, { isRawVideoUpload, workerEventPayload } from '../apps/backend/src/edge/cloudflare-workers/video-event-router';
// NOTE: StreamModule/UploadController/StreamController carry Nest parameter
// decorators which tsx/esbuild cannot transform — verified via static source
// parity (§8) following the Phase 027–042 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '123e4567-e89b-12d3-a456-426614174000';
const VIDEO_ID = '223e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + ladder/keys ----------
{
  for (const s of ['PENDING_UPLOAD', 'UPLOADING', 'TRANSCODING_QUEUED', 'TRANSCODING_PROCESSING', 'READY', 'FAILED']) {
    assert.equal(VideoStatusEnum.safeParse(s).success, true);
  }
  assert.equal(VideoStatusEnum.safeParse('DONE').success, false);
  for (const r of ['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P']) {
    assert.equal(VideoResolutionEnum.safeParse(r).success, true);
  }
  const up = { lessonId: LESSON_ID, fileName: 'ep1.mp4', fileSizeBytes: 1024, mimeType: 'video/mp4' };
  assert.equal(InitiateUploadSchema.safeParse(up).success, true);
  assert.equal(InitiateUploadSchema.safeParse({ ...up, mimeType: 'video/avi' }).success, false);
  assert.equal(InitiateUploadSchema.safeParse({ ...up, fileSizeBytes: 0 }).success, false);
  assert.equal(InitiateUploadSchema.safeParse({ ...up, fileName: '' }).success, false);

  const job = { jobId: randomUUID(), videoId: VIDEO_ID, rawR2Key: 'raw-videos/x', outputPrefix: 'courses/hls/x', resolutions: ['RES_720P'], enableEncryption: true };
  assert.equal(VideoTranscodeJobPayloadSchema.safeParse(job).success, true);
  assert.equal(VideoTranscodeJobPayloadSchema.safeParse({ ...job, resolutions: [] }).success, false);

  const manifest = {
    videoId: VIDEO_ID,
    masterPlaylistUrl: 'https://cdn.example.com/master.m3u8',
    securityToken: 'tok',
    expiresAt: new Date().toISOString(),
    watermarkMetadata: { userIdHash: 'h', displayName: 'Learner', ipAddress: '1.2.3.4' },
  };
  assert.equal(HlsManifestStreamPayloadSchema.safeParse(manifest).success, true);
  assert.equal(HlsManifestStreamPayloadSchema.safeParse({ ...manifest, masterPlaylistUrl: 'notaurl' }).success, false);

  assert.equal(VIDEO_UPLOAD_PART_BYTES, 10 * 1024 * 1024);
  assert.equal(VIDEO_PROGRESS_SYNC_SEC, 5);
  assert.equal(VIDEO_TOKEN_TTL_SEC, 300);
  assert.equal(VIDEO_RAM_BUDGET_MB, 40);
  assert.deepEqual(VIDEO_RENDITION_LADDER.map((r) => r.resolution), ['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P']);
  assert.equal(rawVideoPrefix('v'), 'raw-videos/v');
  assert.equal(rawVideoPartKey('v', 3), 'raw-videos/v/part-00003');
  assert.equal(hlsOutputPrefix('v'), 'courses/hls/v');
  assert.equal(hlsMasterKey('v'), 'courses/hls/v/master.m3u8');
  assert.equal(hlsVariantKey('v', 'RES_720P'), 'courses/hls/v/RES_720P/prog_index.m3u8');
  ok('Zod status/resolution/upload/job/manifest verbatim + ladder + key layout');
}

// ---------- 2. Queue backoff math + crypto + ffmpeg builders ----------
{
  assert.equal(transcodeBackoffMs(1), 500);
  assert.equal(transcodeBackoffMs(2), 1000);
  assert.equal(transcodeBackoffMs(3), 2000);

  const { keyHex, ivHex } = generateAes128Key();
  assert.equal(keyHex.length, 32);
  assert.equal(ivHex.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(keyHex));
  assert.equal(keyFileBytes(keyHex).length, 16);
  assert.equal(keyinfoFile('https://key', '/tmp/k', ivHex), `https://key\n/tmp/k\n${ivHex}`);

  const plan = buildFfmpegCommand({ inputPath: '/tmp/in.mp4', outputDir: '/tmp/out', keyinfoPath: '/tmp/enc.keyinfo', resolutions: ['RES_1080P', 'RES_720P', 'RES_480P', 'RES_360P'] });
  assert.equal(plan.variantCount, 4);
  for (const t of ['split=4', 'scale=w=1920:h=1080', 'scale=w=640:h=360', '5000000', '800000', '-hls_time 6', '-hls_key_info_file', 'master.m3u8', 'var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3"']) {
    assert.ok(plan.command.includes(t), `ffmpeg missing ${t}`);
  }
  assert.throws(() => buildFfmpegCommand({ inputPath: 'x', outputDir: 'y', resolutions: [] }), /No renditions/);
  const evil = buildFfmpegCommand({ inputPath: '/tmp/a;b.mp4', outputDir: '/tmp/o', resolutions: ['RES_360P'] });
  assert.ok(evil.command.includes(`'/tmp/a;b.mp4'`), 'hostile paths are single-quoted');

  const filter = buildWatermarkFilter("O'Reilly: Student");
  assert.ok(filter.startsWith('drawtext=') && filter.includes("\\'") && filter.includes('\\:'));
  ok('AES-128 keygen; FFmpeg ladder command; escaped watermark filter');
}

async function main(): Promise<void> {
  // ---------- 2b. Queue FIFO/retry/DLQ (async drain) ----------
  {
    const order: string[] = [];
    const queue = new VideoTranscodeQueue(2);
    queue.enqueue({ jobId: 'j1', videoId: 'v1', run: async () => { order.push('j1'); } });
    let flaky = 0;
    queue.enqueue({
      jobId: 'j2', videoId: 'v2',
      run: async () => {
        flaky++;
        if (flaky === 1) throw new Error('transient');
        order.push('j2');
      },
    });
    queue.enqueue({ jobId: 'j3', videoId: 'v3', run: async () => { throw new Error('poison'); } });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.deepEqual(order, ['j1', 'j2']);
    assert.equal(queue.deadLetters.length, 1);
    assert.equal(queue.deadLetters[0].jobId, 'j3');
    ok('Queue FIFO + 1-retry + DLQ (poison isolated)');
  }
  // ---------- 3. partCountFor determinism ----------
  {
    assert.equal(partCountFor(0), 0);
    assert.equal(partCountFor(1), 1);
    assert.equal(partCountFor(10 * 1024 * 1024), 1);
    assert.equal(partCountFor(10 * 1024 * 1024 + 1), 2);
    assert.equal(partCountFor(10_000_000_000), 954);
    assert.equal(partCountFor(10_000_000_000n), 954);
    ok('Part manifest derives deterministically from byte size (no schema change)');
  }

  // ---------- 4. Processor lifecycle: READY + renditions + FAILED ----------
  {
    const r2 = new Map<string, Buffer>();
    const tables = (status: { value: string }) => ({
      videoAsset: {
        update: async (a: unknown) => {
          const u = a as { data: { status?: string; errorMessage?: string | null; hlsMasterR2Key?: string } };
          if (u.data.status) status.value = u.data.status;
          return {};
        },
      },
      videoRendition: { create: async () => ({}) },
      videoKeyRotation: { create: async () => ({}) },
    });
    const vault = {
      getObjectBuffer: async (k: string) => {
        const b = r2.get(k);
        if (!b) throw new Error(`missing ${k}`);
        return b;
      },
      putObjectBuffer: async (k: string, body: Buffer) => { r2.set(k, body); return {}; },
    };
    const meta = { findAsset: async () => ({ fileSizeBytes: 25 * 1024 * 1024 }) }; // 3 parts
    for (let i = 1; i <= 3; i++) r2.set(rawVideoPartKey(VIDEO_ID, i), Buffer.from(`part${i}-bytes`));

    const status = { value: 'TRANSCODING_QUEUED' };
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const fakeExec = async (cmd: string) => {
      assert.ok(cmd.includes('ffmpeg') && cmd.includes('libx264'));
      const m = /"([^"]+)\/%v\/prog_index\.m3u8"/.exec(cmd) ?? /(\S+)\/%v\/prog_index\.m3u8/.exec(cmd);
      assert.ok(m, 'output template present');
      const outDir = m[1].replace(/^'/, '').replace(/"$/, '');
      for (const res of ['RES_1080P', 'RES_720P']) {
        await mkdir(join(outDir, res), { recursive: true });
        await writeFile(join(outDir, res, 'prog_index.m3u8'), '#EXTM3U\n');
        await writeFile(join(outDir, res, 'seg_000.ts'), Buffer.from('ts-bytes'));
      }
      await writeFile(join(outDir, 'master.m3u8'), '#EXTM3U\n');
    };
    const proc = new FfmpegWorkerProcessor(tables(status) as never, vault as never, meta as never, fakeExec);
    const out = await proc.process({
      jobId: randomUUID(), videoId: VIDEO_ID, rawR2Key: rawVideoPrefix(VIDEO_ID),
      outputPrefix: hlsOutputPrefix(VIDEO_ID), resolutions: ['RES_1080P', 'RES_720P'], enableEncryption: true,
    });
    assert.equal(status.value, 'READY');
    assert.ok(out.segments >= 5 && out.renditions === 2);
    assert.ok(r2.has(hlsMasterKey(VIDEO_ID)));
    assert.ok(r2.has(`${hlsOutputPrefix(VIDEO_ID)}/RES_720P/seg_000.ts`));

    // Failure path: missing parts → FAILED + rethrow (queue retries → DLQ).
    const failStatus = { value: 'TRANSCODING_QUEUED' };
    const failing = new FfmpegWorkerProcessor(tables(failStatus) as never, { getObjectBuffer: async () => { throw new Error('r2 down'); }, putObjectBuffer: async () => ({}) } as never, meta as never, fakeExec);
    await assert.rejects(() => failing.process({
      jobId: randomUUID(), videoId: VIDEO_ID, rawR2Key: rawVideoPrefix(VIDEO_ID),
      outputPrefix: hlsOutputPrefix(VIDEO_ID), resolutions: ['RES_360P'], enableEncryption: false,
    }), /r2 down/);
    assert.equal(failStatus.value, 'FAILED');

    // Unknown asset → typed error before any mutation.
    const ghost = new FfmpegWorkerProcessor(tables(status) as never, vault as never, { findAsset: async () => null } as never, fakeExec);
    await assert.rejects(() => ghost.process({
      jobId: randomUUID(), videoId: VIDEO_ID, rawR2Key: 'x', outputPrefix: 'y', resolutions: ['RES_360P'], enableEncryption: false,
    }), /not found/);
    ok('Processor READY lifecycle (parts→ffmpeg→upload→rows) + FAILED + ghost guards');
  }

  // ---------- 5. Upload service: initiate/complete/webhook ----------
  {
    const assets = new Map<string, { id: string; status: string; fileSizeBytes: bigint; rawStorageR2Key: string }>();
    const tables = {
      courseLesson: { findUnique: async (a: unknown) => ((a as { where: { id: string } }).where.id === LESSON_ID ? { id: LESSON_ID } : null) },
      videoAsset: {
        upsert: async (a: unknown) => {
          const c = (a as { create: { id: string; lessonId: string } }).create;
          const row = { id: c.id, status: 'PENDING_UPLOAD', fileSizeBytes: 25n * 1024n * 1024n, rawStorageR2Key: rawVideoPrefix(c.id) };
          assets.set(c.id, row);
          return row;
        },
        findUnique: async (a: unknown) => assets.get((a as { where: { id: string } }).where.id) ?? null,
        update: async (a: unknown) => {
          const u = a as { where: { id: string }; data: { status: string } };
          const row = assets.get(u.where.id);
          if (row) row.status = u.data.status;
          return {};
        },
      },
    };
    const vault = { presignedPutUrl: (k: string) => `https://r2.example.com/${k}?sig=put` };
    const queued: Array<{ jobId: string; videoId: string }> = [];
    const runs: string[] = [];
    const svc = new VideoUploadService(tables as never, vault as never, { enqueue: (j) => { queued.push(j); }, depth: 0 } as never, async (p) => { runs.push(p.videoId); }, 'worker-secret');

    const init = await svc.initiateUpload({ lessonId: LESSON_ID, fileName: 'ep1.mp4', fileSizeBytes: 25 * 1024 * 1024, mimeType: 'video/mp4' });
    assert.equal(init.partCount, 3);
    assert.equal(init.parts.length, 3);
    assert.equal(init.partSizeBytes, VIDEO_UPLOAD_PART_BYTES);
    assert.ok(init.parts[0].url.startsWith('https://r2.example.com/'));
    assert.equal((await svc.getUploadStatus(init.videoId)).status, 'UPLOADING');

    const done = await svc.completeUpload(init.videoId);
    assert.equal(done.queued, true);
    assert.equal(queued.length, 1);
    const idempotent = await svc.completeUpload(init.videoId);
    assert.equal(idempotent.queued, false);

    // Worker webhook: bad secret → 404-shaped (no oracle), bad key → 404.
    await assert.rejects(() => svc.handleWorkerEvent({ event: 'VIDEO_RAW_UPLOADED', r2Key: `${rawVideoPrefix(init.videoId)}/part-00001`, size: 1, timestamp: new Date().toISOString() }, 'wrong'), /not found/);
    const dispatched = await svc.handleWorkerEvent({ event: 'VIDEO_RAW_UPLOADED', r2Key: `${rawVideoPrefix(init.videoId)}/part-00001`, size: 1, timestamp: new Date().toISOString() }, 'worker-secret');
    assert.equal(dispatched.queued, false); // already queued → idempotent

    await assert.rejects(() => svc.initiateUpload({ lessonId: '00000000-0000-4000-8000-000000000000', fileName: 'x.mp4', fileSizeBytes: 10, mimeType: 'video/mp4' }), /Lesson not found/);
    ok('Upload initiate (presigned parts) + idempotent complete + secret-checked webhook');
  }

  // ---------- 6. Stream service: manifest/key/progress + preview bypass ----------
  {
    const tables = {
      courseLesson: {
        findUnique: async (a: unknown) => {
          const id = (a as { where: { id: string } }).where.id;
          if (id === 'private-lesson') {
            return { id, isPreview: false, section: { course: { productId: 'prod-1' } } };
          }
          if (id === 'preview-lesson') {
            return { id, isPreview: true, section: { course: { productId: 'prod-1' } } };
          }
          return null;
        },
      },
      entitlement: { findUnique: async () => null },
      videoAsset: {
        findUnique: async (a: unknown) => {
          const id = (a as { where: { lessonId?: string } }).where.lessonId;
          if (id === 'private-lesson' || id === 'preview-lesson') {
            return { id: VIDEO_ID, status: 'READY', hlsMasterR2Key: hlsMasterKey(VIDEO_ID) };
          }
          return null;
        },
      },
      videoKeyRotation: { findFirst: async () => ({ keySecretHex: '00'.repeat(16) }) },
      user: { findUnique: async () => ({ displayName: 'Learner One' }) },
    };
    const written: string[] = [];
    const svc = new StreamService(tables as never, { presignedGetUrl: (k: string) => `https://r2.example.com/${k}?sig=get` } as never, { setex: async (k: string, _t: number, v: string) => { written.push(`${k}=${v}`); } } as never, 'token-secret');

    // Private lesson without entitlement → 403 (Thai message).
    await assert.rejects(() => svc.getManifest(USER_ID, 'private-lesson', '9.9.9.9'), /สิทธิ์/);
    // Preview bypasses entitlement.
    const manifest = await svc.getManifest(USER_ID, 'preview-lesson', '9.9.9.9');
    assert.ok(manifest.masterPlaylistUrl.startsWith('https://r2.example.com/'));
    assert.equal(manifest.watermarkMetadata.displayName, 'Learner One');
    assert.equal(manifest.watermarkMetadata.ipAddress, '9.9.9.9');
    assert.ok(Date.parse(manifest.expiresAt) > Date.now());

    // Key: valid token → 16 bytes; forged/expired → 403; never logged here.
    const key = await svc.getSegmentKey(USER_ID, VIDEO_ID, manifest.securityToken);
    assert.equal(key.length, 16);
    await assert.rejects(() => svc.getSegmentKey(USER_ID, VIDEO_ID, '1.deadbeef'), /Expired/);
    await assert.rejects(() => svc.getSegmentKey(USER_ID, VIDEO_ID, `${Date.now() - 1000}.` + '0'.repeat(64)), /Expired/);

    const rep = await svc.reportProgress(USER_ID, LESSON_ID, 42);
    assert.deepEqual(rep, { recorded: true });
    assert.ok(written.some((w) => w === `progress:video:${USER_ID}:${LESSON_ID}=42`));
    assert.equal(videoProgressKey('u', 'l'), 'progress:video:u:l');
    ok('Manifest gate (403/forbidden vs preview) + key auth + 5s progress buffer');
  }

  // ---------- 7. Worker router: filter + dispatch + retry surface ----------
  {
    assert.equal(isRawVideoUpload({ action: 'PutObject', object: { key: 'raw-videos/v1/part-00001', size: 1 } }), 'raw-videos/v1/part-00001');
    assert.equal(isRawVideoUpload({ action: 'DeleteObject', object: { key: 'raw-videos/v1/part-00001' } }), null);
    assert.equal(isRawVideoUpload({ action: 'PutObject', object: { key: 'courses/hls/v/master.m3u8' } }), null);
    assert.equal(isRawVideoUpload({}), null);
    const payload = workerEventPayload('raw-videos/v/part-00001', 10, '2026-10-07T00:00:00.000Z');
    assert.deepEqual(payload, { event: 'VIDEO_RAW_UPLOADED', r2Key: 'raw-videos/v/part-00001', size: 10, timestamp: '2026-10-07T00:00:00.000Z' });

    const calls: Array<{ url: string; secret: string }> = [];
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), secret: init?.headers?.['X-Worker-Secret'] ?? '' });
      return { ok: true } as Response;
    }) as typeof fetch;
    try {
      await workerRouter.queue(
        { messages: [{ body: { action: 'PutObject', object: { key: 'raw-videos/v9/part-00001', size: 5 } } }, { body: { action: 'PutObject', object: { key: 'other/key' } } }] },
        { VIDEO_WEBHOOK_URL: 'https://api.example.com/hook', WORKER_AUTH_SECRET: 's3cret' },
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.example.com/hook');
      assert.equal(calls[0].secret, 's3cret');
      (globalThis as { fetch: typeof fetch }).fetch = (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch;
      await assert.rejects(() => workerRouter.queue(
        { messages: [{ body: { action: 'PutObject', object: { key: 'raw-videos/v9/part-00001', size: 5 } } }] },
        { VIDEO_WEBHOOK_URL: 'https://api.example.com/hook', WORKER_AUTH_SECRET: 's3cret' },
      ), /dispatch failed/);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    }
    ok('Worker filters raw-videos PutObject, signs webhook, rethrows for redelivery');
  }

  // ---------- 8. Wiring + module SDL/proxy/component parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model VideoAsset', 'model VideoRendition', 'model VideoKeyRotation', 'enum VideoStatus', 'enum VideoResolution', '@@unique([videoId, resolution])', 'lessonId         String      @unique']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['VideoTranscodeJobPayloadSchema', 'HlsManifestStreamPayloadSchema', 'VIDEO_RENDITION_LADDER', 'hlsMasterKey', 'VideoWorkerEventSchema']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/stream/stream.module.ts', 'utf8');
    for (const t of ['VideoUploadService', 'StreamService', 'FfmpegWorkerProcessor', 'VideoTranscodeQueue', 'UploadController', 'StreamController', 'useFactory', 'R2StorageModule']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('StreamModule'));
    const upCtl = readFileSync('apps/backend/src/modules/stream/controllers/upload.controller.ts', 'utf8');
    for (const t of ['api/v1/stream/upload', 'InitiateUploadSchema', 'VideoWorkerEventSchema', 'x-worker-secret']) {
      assert.ok(upCtl.includes(t), `upload controller missing ${t}`);
    }
    const stCtl = readFileSync('apps/backend/src/modules/stream/controllers/stream.controller.ts', 'utf8');
    for (const t of ['api/v1/stream', 'manifest', 'segmentKey', 'no-store', 'VideoProgressReportSchema']) {
      assert.ok(stCtl.includes(t), `stream controller missing ${t}`);
    }
    const r2 = readFileSync('apps/backend/src/infra/cloudflare/r2-storage.service.ts', 'utf8');
    assert.ok(r2.includes('getObjectBuffer') && r2.includes('putObjectBuffer'));
    const player = readFileSync('apps/frontend/components/stream/HlsVideoPlayer.tsx', 'utf8');
    for (const t of ['masterManifestUrl', 'securityToken', 'onProgressSync', 'LIFF_INIT', 'VideoWatermarkOverlay', 'token=', 'setInterval']) {
      assert.ok(player.includes(t), `player missing ${t}`);
    }
    assert.ok(!player.includes("from 'hls.js'") && !player.includes('from "hls.js"'), 'player stays hls.js-free');
    const studio = readFileSync('apps/frontend/components/studio/VideoUploaderStudio.tsx', 'utf8');
    for (const t of ['/api/v1/stream/upload/initiate', '/api/v1/stream/upload/complete', 'TRANSCODING_QUEUED', 'TRANSCODING_PROCESSING', 'READY', 'role="progressbar"']) {
      assert.ok(studio.includes(t), `studio missing ${t}`);
    }
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/stream/upload/initiate/route.ts', ['/api/v1/stream/upload/initiate', '503']],
      ['apps/frontend/app/api/v1/stream/upload/complete/route.ts', ['/api/v1/stream/upload/complete', 'Missing video id']],
      ['apps/frontend/app/api/v1/stream/upload/[videoId]/status/route.ts', ['/api/v1/stream/upload', '/status']],
      ['apps/frontend/app/api/v1/stream/upload/webhook/route.ts', ['x-worker-secret', 'video-uploaded']],
      ['apps/frontend/app/api/v1/stream/manifest/route.ts', ['/api/v1/stream/manifest', 'lessonId']],
      ['apps/frontend/app/api/v1/stream/key/route.ts', ['no-store', 'arrayBuffer']],
      ['apps/frontend/app/api/v1/stream/progress/route.ts', ['/api/v1/stream/progress', 'POST']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Prisma video models + barrel + StreamModule/App + controllers + R2 binary + player/studio/proxies parity');
  }

  console.log(`\nPhase 043 contracts: ${passed} checks passed`);
}

void main();
