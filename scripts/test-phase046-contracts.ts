// SSOT Phase 046 §10 — contract tests (Zod, buffer/flush, hook, wiring)
// Run: npx tsx scripts/test-phase046-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BeaconProgressSchema,
  LessonStreamStateSchema,
  PROGRESS_COMPLETION_RATIO,
  PROGRESS_FLUSH_INTERVAL_SEC,
  PROGRESS_RATE_LIMIT,
  PROGRESS_RATE_WINDOW_SEC,
  PROGRESS_SYNC_INTERVAL_MS,
  SyncProgressInputSchema,
  SyncProgressPayloadSchema,
  bufferCompleted,
  heatmapKey,
  progressBufferKey,
  secondBucket,
} from '../packages/shared/src/schemas/progress-sync.schema';
import { ProgressBufferService } from '../apps/backend/src/infra/redis/progress-buffer.service';
import { ProgressService } from '../apps/backend/src/modules/stream/progress/progress.service';
import { enqueueOfflineSync, flushOfflineQueue } from '../apps/frontend/components/video/hooks/useVideoProgressSync';
// NOTE: ProgressModule/controllers/resolvers carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–045 precedent. The hook imports react (resolvable)
// but only touches window/navigator inside callbacks.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const LESSON_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER_ID = 'user-001';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + keys/buckets ----------
{
  const input = { lessonId: LESSON_ID, watchedSec: 300, durationSec: 600, isCompleted: false, clientTimestamp: new Date().toISOString() };
  assert.equal(SyncProgressInputSchema.safeParse(input).success, true);
  const defaulted = SyncProgressInputSchema.safeParse({ lessonId: LESSON_ID, watchedSec: 1, durationSec: 60, clientTimestamp: new Date().toISOString() });
  assert.equal(defaulted.success, true);
  if (defaulted.success) assert.equal(defaulted.data.isCompleted, false);
  assert.equal(SyncProgressInputSchema.safeParse({ ...input, watchedSec: -1 }).success, false);
  assert.equal(SyncProgressInputSchema.safeParse({ ...input, durationSec: 0 }).success, false);
  assert.equal(SyncProgressInputSchema.safeParse({ ...input, clientTimestamp: 'yesterday' }).success, false);

  assert.equal(SyncProgressPayloadSchema.safeParse({ success: true, lessonId: LESSON_ID, savedWatchedSec: 300, isCompleted: false, serverTimestamp: new Date().toISOString() }).success, true);
  assert.equal(LessonStreamStateSchema.safeParse({ lessonId: LESSON_ID, hlsPlaylistUrl: 'https://cdn.example.com/m.m3u8', lastWatchedSec: 10, durationSec: 600, isCompleted: false }).success, true);
  assert.equal(BeaconProgressSchema.safeParse({ userId: USER_ID, input }).success, true);
  assert.equal(BeaconProgressSchema.safeParse({ userId: '', input }).success, false);

  assert.equal(PROGRESS_SYNC_INTERVAL_MS, 5000);
  assert.equal(PROGRESS_FLUSH_INTERVAL_SEC, 30);
  assert.equal(PROGRESS_RATE_LIMIT, 2);
  assert.equal(PROGRESS_RATE_WINDOW_SEC, 5);
  assert.equal(PROGRESS_COMPLETION_RATIO, 0.95);
  assert.equal(progressBufferKey('u', 'l'), 'progress:buffer:u:l');
  assert.equal(heatmapKey('l'), 'heatmap:video:l');
  assert.equal(secondBucket(7), 5);
  assert.equal(secondBucket(10), 10);
  assert.equal(bufferCompleted(570, 600, false), true);
  assert.equal(bufferCompleted(569, 600, false), false);
  assert.equal(bufferCompleted(0, 600, true), true);
  ok('Zod input/payload/state/beacon verbatim + budgets + keys + 95% rule');
}

type MemHash = Map<string, Record<string, string>>;
function fakeEdge() {
  const hashes: MemHash = new Map();
  const zsets = new Map<string, Map<string, number>>();
  const counters = new Map<string, number>();
  const calls = { hset: 0, zincrby: 0, expire: 0, del: 0 };
  return {
    hashes,
    zsets,
    calls,
    edge: {
      hset: async (k: string, f: Record<string, string>) => { calls.hset++; hashes.set(k, { ...f }); },
      hgetall: async (k: string) => hashes.get(k) ?? {},
      zincrby: async (k: string, by: number, m: string) => {
        calls.zincrby++;
        const z = zsets.get(k) ?? new Map<string, number>();
        z.set(m, (z.get(m) ?? 0) + by);
        zsets.set(k, z);
      },
      expire: async () => { calls.expire++; },
      del: async (...ks: string[]) => { calls.del++; for (const k of ks) hashes.delete(k); },
      scanKeys: async (pattern: string) => {
        const rx = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        return [...hashes.keys()].filter((k) => rx.test(k));
      },
      incr: async (k: string) => {
        const n = (counters.get(k) ?? 0) + 1;
        counters.set(k, n);
        return n;
      },
    },
  };
}

function fakePrisma() {
  const db = new Map<string, { watchedSec: number; isCompleted: boolean; updatedAt: Date }>();
  return {
    db,
    prisma: {
      courseLearningProgress: {
        findUnique: async (a: unknown) => {
          const w = (a as { where: { userId_lessonId: { userId: string; lessonId: string } } }).where.userId_lessonId;
          return db.get(`${w.userId}:${w.lessonId}`) ?? null;
        },
        upsert: async (a: unknown) => {
          const u = a as { where: { userId_lessonId: { userId: string; lessonId: string } }; create: { watchedSec: number; isCompleted: boolean } };
          const row = { watchedSec: u.create.watchedSec, isCompleted: u.create.isCompleted, updatedAt: new Date('2026-10-07T00:00:00.000Z') };
          db.set(`${u.where.userId_lessonId.userId}:${u.where.userId_lessonId.lessonId}`, row);
          return row;
        },
      },
    },
  };
}

const baseInput = (watchedSec: number, durationSec = 600, isCompleted = false) => ({
  lessonId: LESSON_ID, watchedSec, durationSec, isCompleted, clientTimestamp: new Date().toISOString(),
});

async function main(): Promise<void> {
  // ---------- 2. Buffer: monotonic + clamp + heatmap + completion ----------
  {
    const { edge, hashes, zsets } = fakeEdge();
    // NOTE: no rate edge here (covered in §3) so buffer scenarios stay deterministic.
    const svc = new ProgressService(new ProgressBufferService(edge as never), fakePrisma().prisma as never, undefined, () => 1_000_000);
    const first = await svc.bufferProgressSync(USER_ID, baseInput(100));
    assert.equal(first.savedWatchedSec, 100);
    assert.equal(first.isCompleted, false);
    assert.equal(hashes.get(progressBufferKey(USER_ID, LESSON_ID))?.['watchedSec'], '100');
    assert.equal(zsets.get(heatmapKey(LESSON_ID))?.get('100'), 1);

    // Rewind never regresses the buffer (monotonic max).
    const rewind = await svc.bufferProgressSync(USER_ID, baseInput(40));
    assert.equal(rewind.savedWatchedSec, 100);

    // Over-duration clamps to durationSec (fresh user → no velocity prior).
    const overSvc = new ProgressService(new ProgressBufferService(edge as never), fakePrisma().prisma as never, undefined, () => 1_000_000);
    const over = await overSvc.bufferProgressSync('clamp-user', baseInput(9999));
    assert.equal(over.savedWatchedSec, 600);
    assert.equal(over.isCompleted, true);

    // Velocity cap: +4_900s in 0s of wall time is capped at prior+120, not stored.
    const teleport = await svc.bufferProgressSync(USER_ID, baseInput(5000));
    assert.equal(teleport.savedWatchedSec, 220);
    ok('Buffer monotonic max + duration clamp + velocity cap + heatmap ZSET + 95% completion');
  }

  // ---------- 3. Rate limit (2/5s → 429, no PII in logs) ----------
  {
    const { edge } = fakeEdge();
    const svc = new ProgressService(new ProgressBufferService(edge as never), fakePrisma().prisma as never, edge as never, () => 2_000_000);
    await svc.bufferProgressSync('limited-user', baseInput(10));
    await svc.bufferProgressSync('limited-user', baseInput(20));
    await assert.rejects(() => svc.bufferProgressSync('limited-user', baseInput(30)), /Too many progress syncs/);
    // A different user is unaffected.
    await svc.bufferProgressSync('other-user', baseInput(30));
    ok('Fixed-window 2-per-5s rejects the third burst with 429');
  }

  // ---------- 4. Flush: buffer ⨯ DB max + scheduler sweep ----------
  {
    const { edge } = fakeEdge();
    const { prisma, db } = fakePrisma();
    db.set(`${USER_ID}:${LESSON_ID}`, { watchedSec: 200, isCompleted: false, updatedAt: new Date() });
    // NOTE: no rate edge here (covered in §3) so flush scenarios stay deterministic.
    const svc = new ProgressService(new ProgressBufferService(edge as never), prisma as never, undefined, () => 3_000_000);

    // DB ahead (another device) wins over a stale buffer.
    await svc.bufferProgressSync(USER_ID, baseInput(50));
    const kept = await svc.flushBuffer(USER_ID, LESSON_ID);
    assert.equal(kept.flushed, true);
    assert.equal(db.get(`${USER_ID}:${LESSON_ID}`)?.watchedSec, 200);
    assert.equal((await edge.hgetall(progressBufferKey(USER_ID, LESSON_ID))).watchedSec, undefined);

    // Buffer ahead wins + completion recomputed from stored duration.
    await svc.bufferProgressSync(USER_ID, baseInput(590));
    await svc.flushBuffer(USER_ID, LESSON_ID);
    const row = db.get(`${USER_ID}:${LESSON_ID}`);
    assert.equal(row?.watchedSec, 590);
    assert.equal(row?.isCompleted, true);

    // Empty buffer → no-op; unwired → no-op.
    assert.deepEqual(await svc.flushBuffer('ghost', LESSON_ID), { flushed: false });
    assert.deepEqual(await new ProgressService().flushBuffer(USER_ID, LESSON_ID), { flushed: false });
    assert.deepEqual(await new ProgressService().flushAllDue(), { scanned: 0, flushed: 0 });

    // Sweep parses colon-free uuid keys only.
    await svc.bufferProgressSync(USER_ID, baseInput(600));
    const sweep = await svc.flushAllDue();
    assert.equal(sweep.scanned, 1);
    assert.equal(sweep.flushed, 1);
    assert.equal(db.get(`${USER_ID}:${LESSON_ID}`)?.watchedSec, 600);
    ok('Flush takes buffer⨯DB max, preserves completion, sweeps keyspace');
  }

  // ---------- 5. Offline queue helpers (node: fail-open, no window) ----------
  {
    enqueueOfflineSync({ lessonId: LESSON_ID, watchedSec: 10, durationSec: 600, isCompleted: false, clientTimestamp: new Date().toISOString() });
    assert.equal(await flushOfflineQueue(), 0); // no fetch target in unit env → stays queued, never throws
    ok('Offline queue fail-open without a browser');
  }

  // ---------- 6. Wiring + DTO/SDL/hook/player/proxy parity (Gates 1/9) ----------
  {
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['SyncProgressInputSchema', 'SyncProgressPayloadSchema', 'LessonStreamStateSchema', 'progressBufferKey', 'heatmapKey', 'BeaconProgressSchema']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const svcSrc = readFileSync('apps/backend/src/modules/stream/progress/progress.service.ts', 'utf8');
    for (const t of ['bufferProgressSync', 'flushBuffer', 'flushAllDue', 'TOO_MANY_REQUESTS', 'velocityCap', 'progress:buffer']) {
      assert.ok(svcSrc.includes(t), `progress service missing ${t}`);
    }
    const bufSrc = readFileSync('apps/backend/src/infra/redis/progress-buffer.service.ts', 'utf8');
    for (const t of ['hset', 'hgetall', 'zincrby', 'PROGRESS_BUFFER_TTL_SEC', 'scanBuffered']) {
      assert.ok(bufSrc.includes(t), `buffer service missing ${t}`);
    }
    const cluster = readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
    for (const t of ['hset', 'hgetall', 'zincrby', 'incr(']) {
      assert.ok(cluster.includes(t), `cluster missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/stream/progress/progress.controller.ts', 'utf8');
    for (const t of ['api/v1/stream/progress', "'sync'", "'beacon'", 'JwtAuthGuard', 'BeaconProgressSchema']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const rslSrc = readFileSync('apps/backend/src/modules/stream/progress/progress.resolver.ts', 'utf8');
    for (const t of ['syncLessonProgressBuffered', 'ProgressSyncInput', 'ProgressSyncPayload', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const modSrc = readFileSync('apps/backend/src/modules/stream/progress/progress.module.ts', 'utf8');
    for (const t of ['ProgressService', 'ProgressController', 'ProgressResolver', 'ProgressBufferService', 'ProgressFlushStarter', 'PROGRESS_FLUSH_INTERVAL_SEC']) {
      assert.ok(modSrc.includes(t), `module missing ${t}`);
    }
    assert.ok(readFileSync('apps/backend/src/modules/stream/stream.module.ts', 'utf8').includes('ProgressModule'));
    const dtoIn = readFileSync('apps/backend/src/modules/stream/progress/dto/sync-progress.input.ts', 'utf8');
    assert.ok(dtoIn.includes("from '@repo/shared'") && dtoIn.includes('SyncProgressInputSchema'));
    const hook = readFileSync('apps/frontend/components/video/hooks/useVideoProgressSync.ts', 'utf8');
    for (const t of ['sendBeacon', 'startSyncTimer', 'stopSyncTimer', 'executeSync', 'PROGRESS_SYNC_INTERVAL_MS', 'flushOfflineQueue']) {
      assert.ok(hook.includes(t), `hook missing ${t}`);
    }
    const player = readFileSync('apps/frontend/components/video/HlsVideoPlayer.tsx', 'utf8');
    for (const t of ['useVideoProgressSync', 'beacon', 'pulse', 'StreamPlayer']) {
      assert.ok(player.includes(t), `video player missing ${t}`);
    }
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/stream/progress/sync/route.ts', ['/api/v1/stream/progress/sync', '503']],
      ['apps/frontend/app/api/v1/stream/progress/beacon/route.ts', ['/api/v1/stream/progress/beacon', 'Empty beacon']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Barrel + buffer/cluster + controller/resolver/module/DTO + hook/player/proxies parity');
  }

  console.log(`\nPhase 046 contracts: ${passed} checks passed`);
}

void main();
