// SSOT Phase 045 §10 — contract tests (Zod, stream state/sync, player, wiring)
// Run: npx tsx scripts/test-phase045-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LESSON_COMPLETION_RATIO,
  LESSON_STATE_CACHE_SEC,
  LessonStreamPayloadSchema,
  PlaybackSpeedEnum,
  ProgressSyncResponseSchema,
  SyncLessonProgressSchema,
  VIDEO_DROPOFF_STREAM,
  VideoQualityEnum,
  clampResumeSec,
  isLessonCompleted,
} from '../packages/shared/src/schemas/stream-contract';
import { StreamService } from '../apps/backend/src/modules/stream/services/stream.service';
import { applyPlaybackSpeed } from '../apps/frontend/components/player/SpeedController';
// NOTE: StreamModule/root+sub controllers/resolvers carry Nest parameter
// decorators which tsx/esbuild cannot transform — verified via static source
// parity (§7) following the Phase 027–044 precedent. SpeedController imports
// react (resolvable) but applyPlaybackSpeed is DOM-free.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + helpers ----------
{
  for (const s of ['0.5', '0.75', '1.0', '1.25', '1.5', '1.75', '2.0', '2.25', '2.5']) {
    assert.equal(PlaybackSpeedEnum.safeParse(s).success, true);
  }
  assert.equal(PlaybackSpeedEnum.safeParse('3.0').success, false);
  assert.equal(PlaybackSpeedEnum.safeParse(1).success, false);
  for (const q of ['AUTO', '1080P', '720P', '480P', '360P']) {
    assert.equal(VideoQualityEnum.safeParse(q).success, true);
  }
  assert.equal(VideoQualityEnum.safeParse('4K').success, false);

  const state = {
    lessonId: LESSON_ID,
    hlsManifestUrl: 'https://cdn.example.com/lesson/master.m3u8',
    signedEdgeToken: 'tok',
    lastWatchedSec: 120,
    durationSec: 600,
    forensicWatermark: { userIdHash: 'hash12', displayName: 'Learner', timestamp: new Date().toISOString() },
  };
  assert.equal(LessonStreamPayloadSchema.safeParse(state).success, true);
  assert.equal(LessonStreamPayloadSchema.safeParse({ ...state, lastWatchedSec: -1 }).success, false);
  assert.equal(LessonStreamPayloadSchema.safeParse({ ...state, durationSec: 0 }).success, false);

  const sync = { lessonId: LESSON_ID, watchedSec: 300, durationSec: 600, isCompleted: false };
  assert.equal(SyncLessonProgressSchema.safeParse(sync).success, true);
  assert.equal(SyncLessonProgressSchema.safeParse({ ...sync, watchedSec: -1 }).success, false);
  assert.equal(ProgressSyncResponseSchema.safeParse({ success: true, updatedAt: new Date().toISOString(), isCompleted: false }).success, true);

  assert.equal(LESSON_COMPLETION_RATIO, 0.9);
  assert.equal(LESSON_STATE_CACHE_SEC, 60);
  assert.equal(VIDEO_DROPOFF_STREAM, 'stream:video-dropoff-events');
  assert.equal(isLessonCompleted(540, 600, false), true);
  assert.equal(isLessonCompleted(539, 600, false), false);
  assert.equal(isLessonCompleted(0, 600, true), true);
  assert.equal(isLessonCompleted(10, 0, false), false);
  assert.equal(clampResumeSec(120, 600), 120);
  assert.equal(clampResumeSec(-5, 600), 0);
  assert.equal(clampResumeSec(600, 600), 599);
  assert.equal(clampResumeSec(Number.NaN, 600), 0);
  ok('Zod speed/quality/state/sync verbatim + completion/resume math');
}

// ---------- 2. Speed binding (pitch-preserved, DOM-free) ----------
{
  const calls: Array<{ rate: number; pitch: boolean | undefined }> = [];
  const video = {
    playbackRate: 1,
    preservesPitch: false,
    set playbackRateCapture(_v: number) {},
  };
  const el = {
    playbackRate: 1,
    preservesPitch: false,
  } as unknown as HTMLVideoElement;
  applyPlaybackSpeed(el, '2.0');
  assert.equal(el.playbackRate, 2);
  assert.equal((el as unknown as { preservesPitch: boolean }).preservesPitch, true);
  applyPlaybackSpeed(null, '1.5');
  void calls;
  void video;
  ok('Speed binding sets rate + pitch guard, null-safe');
}

async function main(): Promise<void> {
  // ---------- 3. getLessonStreamState: gate + resume + watermark ----------
  {
    const tables = (opts: { entitled: boolean; watched: number | null }) => ({
      courseLesson: {
        findUnique: async () => ({ id: LESSON_ID, isPreview: false, durationSec: 600, section: { course: { productId: 'prod-1' } } }),
      },
      entitlement: { findUnique: async () => (opts.entitled ? { userId: USER_ID } : null) },
      videoAsset: { findUnique: async () => ({ id: 'vid-1', status: 'READY', hlsMasterR2Key: 'courses/hls/vid-1/master.m3u8' }) },
      videoKeyRotation: { findFirst: async () => null },
      user: { findUnique: async () => ({ displayName: 'Learner One' }) },
      courseLearningProgress: {
        findUnique: async () => (opts.watched === null ? null : { watchedSec: opts.watched, isCompleted: false, updatedAt: new Date() }),
        upsert: async () => ({ watchedSec: 0, isCompleted: false, updatedAt: new Date() }),
      },
    });
    const vault = { presignedGetUrl: (k: string) => `https://r2.example.com/${k}?sig=get` };
    const svc = new StreamService(tables({ entitled: true, watched: 120 }) as never, vault as never, undefined, 'token-secret');
    const state = await svc.getLessonStreamState(USER_ID, LESSON_ID, '9.9.9.9');
    assert.equal(LessonStreamPayloadSchema.safeParse(state).success, true);
    assert.equal(state.lastWatchedSec, 120);
    assert.equal(state.durationSec, 600);
    assert.equal(state.forensicWatermark.displayName, 'Learner One');
    assert.ok(state.hlsManifestUrl.startsWith('https://r2.example.com/'));

    const fresh = new StreamService(tables({ entitled: true, watched: null }) as never, vault as never, undefined, 'token-secret');
    assert.equal((await fresh.getLessonStreamState(USER_ID, LESSON_ID, '1.1.1.1')).lastWatchedSec, 0);

    const gated = new StreamService(tables({ entitled: false, watched: null }) as never, vault as never, undefined, 'token-secret');
    await assert.rejects(() => gated.getLessonStreamState(USER_ID, LESSON_ID, '1.1.1.1'), /entitlement/);
    ok('Stream state: entitled resume + fresh zero + gated 403');
  }

  // ---------- 4. syncLessonProgress: upsert + 90% rule + heatmap event ----------
  {
    const upserts: unknown[] = [];
    const events: unknown[] = [];
    const row = (watched: number, done: boolean) => ({ watchedSec: watched, isCompleted: done, updatedAt: new Date('2026-10-07T00:00:00.000Z') });
    const svc = new StreamService(
      {
        courseLesson: { findUnique: async () => null },
        entitlement: { findUnique: async () => null },
        videoAsset: { findUnique: async () => null },
        videoKeyRotation: { findFirst: async () => null },
        user: { findUnique: async () => null },
        courseLearningProgress: {
          findUnique: async () => null,
          upsert: async (a: unknown) => {
            const u = a as { create: { watchedSec: number; isCompleted: boolean } };
            upserts.push(u.create);
            return row(u.create.watchedSec, u.create.isCompleted);
          },
        },
      } as never,
      undefined,
      undefined,
      'token-secret',
      (e) => events.push(e),
    );
    const partial = await svc.syncLessonProgress(USER_ID, { lessonId: LESSON_ID, watchedSec: 100, durationSec: 600, isCompleted: false });
    assert.equal(partial.success, true);
    assert.equal(partial.isCompleted, false);
    const done = await svc.syncLessonProgress(USER_ID, { lessonId: LESSON_ID, watchedSec: 590, durationSec: 600, isCompleted: false });
    assert.equal(done.isCompleted, true); // 90% auto-complete, no client flag needed
    const flagged = await svc.syncLessonProgress(USER_ID, { lessonId: LESSON_ID, watchedSec: 10, durationSec: 600, isCompleted: true });
    assert.equal(flagged.isCompleted, true);
    assert.equal(upserts.length, 3);
    assert.equal(events.length, 3);

    await assert.rejects(
      () => new StreamService(undefined, undefined, undefined, 's').syncLessonProgress(USER_ID, { lessonId: LESSON_ID, watchedSec: 1, durationSec: 10, isCompleted: false }),
      /unavailable/,
    );
    ok('Heartbeat upsert + auto-complete + heatmap events + fail-closed');
  }

  // ---------- 5. Phase 043 regression guard: manifest/key/report untouched ----------
  {
    const svc = new StreamService(
      {
        courseLesson: { findUnique: async () => ({ id: LESSON_ID, isPreview: true, durationSec: 600, section: { course: { productId: 'p' } } }) },
        entitlement: { findUnique: async () => null },
        videoAsset: { findUnique: async () => ({ id: 'vid-1', status: 'READY', hlsMasterR2Key: 'k/master.m3u8' }) },
        videoKeyRotation: { findFirst: async () => ({ keySecretHex: '00'.repeat(16) }) },
        user: { findUnique: async () => ({ displayName: 'L' }) },
      } as never,
      { presignedGetUrl: (k: string) => `https://r2.example.com/${k}` } as never,
      undefined,
      'token-secret',
    );
    const manifest = await svc.getManifest(USER_ID, LESSON_ID, '1.1.1.1');
    assert.ok(manifest.masterPlaylistUrl.includes('k/master.m3u8'));
    const key = await svc.getSegmentKey(USER_ID, manifest.videoId, manifest.securityToken);
    assert.equal(key.length, 16);
    assert.deepEqual(await svc.reportProgress(USER_ID, LESSON_ID, 5), { recorded: true });
    ok('043 delivery surface intact behind 045 additions');
  }

  // ---------- 6. Wiring + SDL/player/component/page parity (Gates 1/9) ----------
  {
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['PlaybackSpeedEnum', 'VideoQualityEnum', 'LessonStreamPayloadSchema', 'SyncLessonProgressSchema', 'isLessonCompleted', 'clampResumeSec']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const svcSrc = readFileSync('apps/backend/src/modules/stream/services/stream.service.ts', 'utf8');
    for (const t of ['getLessonStreamState', 'syncLessonProgress', 'courseLearningProgress', 'isLessonCompleted']) {
      assert.ok(svcSrc.includes(t), `stream service missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/stream/controllers/stream.controller.ts', 'utf8');
    for (const t of ['lesson-state', 'lesson-progress', 'SyncLessonProgressSchema']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const rslSrc = readFileSync('apps/backend/src/api/graphql/stream/stream.resolver.ts', 'utf8');
    for (const t of ['getLessonStreamState', 'syncLessonProgress', 'LessonStreamPayload', 'StreamProgressSyncResponse', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/stream.graphql/schema.graphql', 'utf8');
    for (const t of ['getLessonStreamState', 'syncLessonProgress', 'LessonStreamPayload', 'StreamProgressSyncResponse', 'SyncLessonProgressInput']) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    const player = readFileSync('apps/frontend/components/stream/HlsVideoPlayer.tsx', 'utf8');
    for (const t of ['SpeedController', 'QualitySelector', 'initialTime', 'applyPlaybackSpeed', 'isCompleted', 'LESSON_COMPLETION_RATIO', 'requestFullscreen']) {
      assert.ok(player.includes(t), `player missing ${t}`);
    }
    assert.ok(!player.includes("from 'hls.js'") && !player.includes("from 'lucide-react'"), 'player stays dep-free');
    const speed = readFileSync('apps/frontend/components/player/SpeedController.tsx', 'utf8');
    assert.ok(speed.includes('PlaybackSpeedEnum') && speed.includes('applyPlaybackSpeed') && speed.includes('preservesPitch'));
    const quality = readFileSync('apps/frontend/components/player/QualitySelector.tsx', 'utf8');
    assert.ok(quality.includes('AUTO') && quality.includes('onChange'));
    const page = readFileSync('apps/frontend/app/(liff)/course/[courseId]/lesson/[lessonId]/page.tsx', 'utf8');
    for (const t of ['LIFF_INIT', 'fetchLessonState', 'HlsVideoPlayer', 'reportLessonHeartbeat', 'initialTime']) {
      assert.ok(page.includes(t), `lesson page missing ${t}`);
    }
    const client = readFileSync('apps/frontend/lib/stream/lesson-stream-client.ts', 'utf8');
    assert.ok(client.includes('fetchLessonState') && client.includes('reportLessonHeartbeat'));
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/stream/lesson-state/route.ts', ['/api/v1/stream/lesson-state', 'lessonId']],
      ['apps/frontend/app/api/v1/stream/lesson-progress/route.ts', ['/api/v1/stream/lesson-progress', 'POST']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Barrel + service/gateway/resolver/SDL + player/speed/quality/page/client/proxies parity + dep-free guard');
  }

  console.log(`\nPhase 045 contracts: ${passed} checks passed`);
}

void main();
