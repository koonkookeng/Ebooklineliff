// SSOT Phase 050 §10 — contract tests (Zod, HMAC tokens, session/ban, rate guard, wiring)
// Run: npx tsx scripts/test-phase050-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  StreamTokenTypeEnum,
  HlsStreamTokenRequestSchema,
  HlsStreamTokenPayloadSchema,
  VideoSegmentRequestSchema,
  AntiScrapingViolationLogSchema,
  VIDEO_RATE_WINDOW_SEC,
  VIDEO_RATE_MAX_BURST_SEGMENTS,
  VIDEO_SCRAPE_BURST_PER_SEC,
  VIDEO_SCRAPE_RISK_BAN_THRESHOLD,
  VIDEO_TOKEN_TTL_SEC,
  VIDEO_KEY_ROTATION_SEC,
  VIDEO_TOKEN_RENEW_SEC,
  VIDEO_PLAYER_MAX_BUFFER_SEC,
  VIDEO_429_RETRY_BASE_MS,
  videoRateLimitKey,
  videoHeartbeatKey,
  videoRiskScoreKey,
  videoRequestStreamKey,
  videoSessionKey,
  videoBackoffMs,
  isNonSequentialFetch,
} from '../packages/shared/src/schemas/video-security.schema';
import { HlsSecurityService } from '../apps/backend/src/modules/stream/services/hls-security.service';
import {
  VideoSessionService,
  escalateAction,
} from '../apps/backend/src/modules/stream/services/video-session.service';
import {
  VideoRateLimitGuard,
  evaluateVideoRate,
} from '../apps/backend/src/modules/stream/guards/video-rate-limit.guard';
// NOTE: HlsStreamController/VideoSecurityModule carry Nest parameter decorators
// which tsx/esbuild cannot transform — verified via static source parity (§8)
// following the Phase 027–049 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const LESSON_ID = '223e4567-e89b-12d3-a456-426614174000';
const FINGERPRINT = 'device-fingerprint-0123456789abcdef';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  for (const s of ['MANIFEST_ACCESS', 'SEGMENT_FETCH', 'KEY_DECRYPTION']) {
    assert.equal(StreamTokenTypeEnum.safeParse(s).success, true);
  }
  assert.equal(StreamTokenTypeEnum.safeParse('WATCH').success, false);

  const tokenReq = {
    lessonId: LESSON_ID,
    userId: USER_ID,
    deviceFingerprint: FINGERPRINT,
    ipAddress: '203.0.113.7',
  };
  assert.equal(HlsStreamTokenRequestSchema.safeParse(tokenReq).success, true);
  assert.equal(
    HlsStreamTokenRequestSchema.safeParse({ ...tokenReq, deviceFingerprint: 'short' }).success,
    false,
  );
  assert.equal(HlsStreamTokenRequestSchema.safeParse({ ...tokenReq, ipAddress: 'nope' }).success, false);

  const payload = {
    streamToken: 'tok',
    expiresAt: Date.now() + 10000,
    playbackSessionId: USER_ID,
  };
  assert.equal(HlsStreamTokenPayloadSchema.safeParse(payload).success, true);
  assert.equal(
    HlsStreamTokenPayloadSchema.parse(payload).keyRotationIntervalSec,
    10,
  );

  const seg = { lessonId: LESSON_ID, segmentName: 'seg_00012.ts', token: 't', clientTimestamp: 1 };
  assert.equal(VideoSegmentRequestSchema.safeParse(seg).success, true);
  assert.equal(VideoSegmentRequestSchema.safeParse({ ...seg, segmentName: 'seg_2.m4s' }).success, true);
  assert.equal(VideoSegmentRequestSchema.safeParse({ ...seg, segmentName: '../evil.ts' }).success, false);
  assert.equal(VideoSegmentRequestSchema.safeParse({ ...seg, segmentName: 'seg.mp4' }).success, false);

  const viol = {
    userId: USER_ID,
    lessonId: LESSON_ID,
    ipAddress: '203.0.113.7',
    requestCountPerSec: 12,
    actionTaken: 'TEMPORARY_BLOCK',
    userAgent: 'yt-dlp/1.0',
  };
  assert.equal(AntiScrapingViolationLogSchema.safeParse(viol).success, true);
  assert.equal(
    AntiScrapingViolationLogSchema.safeParse({ ...viol, actionTaken: 'BAN' }).success,
    false,
  );

  assert.equal(VIDEO_RATE_WINDOW_SEC, 2);
  assert.equal(VIDEO_RATE_MAX_BURST_SEGMENTS, 5);
  assert.equal(VIDEO_SCRAPE_BURST_PER_SEC, 8);
  assert.equal(VIDEO_SCRAPE_RISK_BAN_THRESHOLD, 100);
  assert.equal(VIDEO_TOKEN_TTL_SEC, 10);
  assert.equal(VIDEO_KEY_ROTATION_SEC, 10);
  assert.equal(VIDEO_TOKEN_RENEW_SEC, 8);
  assert.equal(VIDEO_PLAYER_MAX_BUFFER_SEC, 10);
  assert.equal(VIDEO_429_RETRY_BASE_MS, 3000);
  assert.equal(videoRateLimitKey('u', 'l'), 'rate_limit:video_segment:u:l');
  assert.equal(videoHeartbeatKey('u', 'l'), 'video:heartbeat:u:l');
  assert.equal(videoRiskScoreKey('u'), 'video:risk:u');
  assert.equal(videoRequestStreamKey(), 'stream:video:requests');
  assert.equal(videoSessionKey('s'), 'video:session:s');
  assert.equal(videoBackoffMs(0), 3000);
  assert.equal(videoBackoffMs(1), 6000);
  assert.equal(videoBackoffMs(10), 30000);
  assert.equal(isNonSequentialFetch(5, 5), false);
  assert.equal(isNonSequentialFetch(6, 5), false);
  assert.equal(isNonSequentialFetch(9, 5), true);
  assert.equal(isNonSequentialFetch(3, 5), true);
  ok('Zod token/segment/violation verbatim + budgets/keys/backoff/sequence helpers');
}

// ---------- 2. HlsSecurityService (§5.3/§8.1: HMAC 10s tokens, playlist rewrite, key rotation) ----------
async function sectionSecurityService(): Promise<void> {
  const calls: string[] = [];
  const r2 = {
    getObjectText: async (key: string) => {
      calls.push(key);
      return (
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="old/key"\n' +
        '#EXTINF:4.0,\nseg_00000.ts\n#EXTINF:4.0,\nseg_00001.ts\n'
      );
    },
    getObjectBuffer: async (key: string) => Buffer.from(`bytes:${key}`),
  };
  const svc = new HlsSecurityService(r2, 'test-secret-050');

  const tok = svc.signToken(LESSON_ID, 'SEGMENT_FETCH');
  svc.verifyToken(tok, LESSON_ID, 'SEGMENT_FETCH');
  assert.throws(() => svc.verifyToken(tok, USER_ID, 'SEGMENT_FETCH'), /scope mismatch/);
  assert.throws(() => svc.verifyToken(tok, LESSON_ID, 'KEY_DECRYPTION'), /scope mismatch/);
  assert.throws(() => svc.verifyToken(`${tok}tamper`, LESSON_ID, 'SEGMENT_FETCH'), /signature/);
  assert.throws(() => svc.verifyToken('garbage', LESSON_ID, 'SEGMENT_FETCH'), /Invalid stream token/);
  const expired = svc.signToken(LESSON_ID, 'SEGMENT_FETCH', -5);
  assert.throws(() => svc.verifyToken(expired, LESSON_ID, 'SEGMENT_FETCH'), /expired/);

  await svc.verifySegmentToken(tok, LESSON_ID, 'seg_00012.ts');
  await assert.rejects(() => svc.verifySegmentToken(tok, LESSON_ID, '../x.ts'), /Invalid segment/);

  const manifestTok = svc.signToken(LESSON_ID, 'MANIFEST_ACCESS');
  const playlist = await svc.generateDynamicM3u8Playlist(LESSON_ID, manifestTok);
  assert.ok(playlist.includes(`/api/v1/hls/${LESSON_ID}/segments/seg_00000.ts?token=`));
  assert.ok(playlist.includes(`/api/v1/hls/${LESSON_ID}/key?token=`));
  assert.ok(!playlist.includes('old/key'));
  assert.deepEqual(calls, [`hls/${LESSON_ID}/master.m3u8`]);

  const keyTok = svc.signToken(LESSON_ID, 'KEY_DECRYPTION');
  const k1 = await svc.getRotatedKey(LESSON_ID, keyTok);
  const k2 = await svc.getRotatedKey(LESSON_ID, keyTok);
  assert.equal(k1.length, 16);
  assert.deepEqual(k1, k2); // deterministic within rotation window

  const buf = await svc.fetchR2SegmentStream(LESSON_ID, 'seg_00000.ts');
  assert.equal(buf.toString(), `bytes:hls/${LESSON_ID}/segments/seg_00000.ts`);
  ok('HlsSecurityService: HMAC sign/verify/expiry/scope + playlist rewrite + 16B rotation key + R2 path');
}

// ---------- 3. VideoSessionService (§7.1: sessions + risk escalation) ----------
async function sectionSessionService(): Promise<void> {
  assert.equal(escalateAction(0), 'WARNING_THROTTLE');
  assert.equal(escalateAction(49), 'WARNING_THROTTLE');
  assert.equal(escalateAction(50), 'TEMPORARY_BLOCK');
  assert.equal(escalateAction(99), 'TEMPORARY_BLOCK');
  assert.equal(escalateAction(100), 'PERMANENT_BAN');

  let score = 0;
  const created: unknown[] = [];
  const upserted: unknown[] = [];
  let revoked = 0;
  const db = {
    videoStreamSession: {
      create: async (a: { data: Record<string, unknown> }) => {
        created.push(a.data);
        return { id: 'sess-1', sessionToken: a.data['sessionToken'] as string };
      },
      update: async () => ({}),
      updateMany: async () => {
        revoked += 1;
        return { count: 3 };
      },
    },
    scraperBlacklist: {
      upsert: async (a: unknown) => {
        upserted.push(a);
        return {};
      },
    },
  };
  const redis = {
    setPlaybackHeartbeat: async () => undefined,
    incrementScrapingViolationScore: async () => (score += 25),
  };
  const svc = new VideoSessionService(db, redis);

  const sess = await svc.createPlaybackSession({
    lessonId: LESSON_ID,
    userId: USER_ID,
    deviceFingerprint: FINGERPRINT,
    ipAddress: '203.0.113.7',
  });
  assert.equal(sess.playbackSessionId, 'sess-1');
  assert.ok(sess.sessionToken.length >= 32);
  await assert.rejects(
    svc.createPlaybackSession({
      lessonId: 'bad',
      userId: USER_ID,
      deviceFingerprint: FINGERPRINT,
      ipAddress: '203.0.113.7',
    }),
    /Invalid stream token request/,
  );

  // Sequential playback never touches the ban engine.
  const calm = await svc.noteSegmentFetch({
    userId: USER_ID,
    lessonId: LESSON_ID,
    ipAddress: '203.0.113.7',
    userAgent: 'safari',
    requestedIndex: 6,
    expectedNextIndex: 5,
  });
  assert.equal(calm, null);
  assert.equal(score, 0);

  // Ripper jump: +25 → 25 ⇒ throttle (no revoke, no blacklist row).
  score = 0;
  const warn = await svc.noteSegmentFetch({
    userId: USER_ID,
    lessonId: LESSON_ID,
    ipAddress: '203.0.113.7',
    userAgent: 'yt-dlp',
    requestedIndex: 40,
    expectedNextIndex: 5,
  });
  assert.equal(warn, 'WARNING_THROTTLE');
  assert.equal(revoked, 0);
  assert.equal(upserted.length, 0);

  // Sustained abuse: 60 ≥ 50 ⇒ TEMPORARY_BLOCK + revoke-all + blacklist row.
  const temp = await svc.recordViolation({
    userId: USER_ID,
    lessonId: LESSON_ID,
    ipAddress: '203.0.113.7',
    requestCountPerSec: 12,
    userAgent: 'yt-dlp',
  });
  assert.equal(temp, 'TEMPORARY_BLOCK');
  assert.equal(revoked, 1);
  assert.equal(upserted.length, 1);
  assert.equal(await svc.revokeAllUserSessions(USER_ID), 3);
  ok('VideoSessionService: session create + sequential calm + throttle/ban escalation + revoke');
}

// ---------- 4. Sliding-window verdicts (§5.2: ≤5/2s play, >8 burst) ----------
{
  assert.deepEqual(evaluateVideoRate(0), { allowed: true, burst: false });
  assert.deepEqual(evaluateVideoRate(1), { allowed: true, burst: false });
  assert.deepEqual(evaluateVideoRate(5), { allowed: true, burst: false });
  assert.deepEqual(evaluateVideoRate(6), { allowed: false, burst: false });
  assert.deepEqual(evaluateVideoRate(8), { allowed: false, burst: false });
  assert.deepEqual(evaluateVideoRate(9), { allowed: false, burst: true });
  ok('evaluateVideoRate: normal/burst thresholds');
}

// ---------- 5. Guard live behavior (allow + heartbeat, 429 envelope, 400, fail-open) ----------
async function sectionGuardLive(): Promise<void> {
  const beats: string[] = [];
  const scores: Array<[string, string, number | undefined]> = [];
  const mkCtx = (params: Record<string, string | undefined>, headers: Record<string, string> = {}, count: number | Error = 1) => {
    const redis = {
      trackVideoSegment: async () => {
        if (count instanceof Error) throw count;
        return count;
      },
      incrementScrapingViolationScore: async (u: string, ip: string, w?: number) => {
        scores.push([u, ip, w]);
        return 10;
      },
      setPlaybackHeartbeat: async (u: string, l: string) => {
        beats.push(`${u}:${l}`);
      },
    };
    const guard = new VideoRateLimitGuard(redis);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ params, headers, ip: '203.0.113.9' }),
      }),
    };
    return { guard, ctx: ctx as never };
  };

  const allow = mkCtx({ lessonId: LESSON_ID }, { 'x-user-id': USER_ID }, 3);
  assert.equal(await allow.guard.canActivate(allow.ctx), true);
  assert.deepEqual(beats, [`${USER_ID}:${LESSON_ID}`]);

  const over = mkCtx({ lessonId: LESSON_ID }, { 'x-user-id': USER_ID }, 9);
  await assert.rejects(() => over.guard.canActivate(over.ctx), (e: unknown) => {
    const eAny = e as { status?: number; response?: { statusCode?: number; retryAfterSec?: number } };
    return eAny.status === 429 && eAny.response?.retryAfterSec === 2;
  });
  assert.equal(scores.length, 1);
  assert.equal(scores[0][2], 25); // burst weight

  const missing = mkCtx({}, { 'x-user-id': USER_ID }, 1);
  await assert.rejects(() => missing.guard.canActivate(missing.ctx), /Missing lesson scope/);

  const down = mkCtx({ lessonId: LESSON_ID }, { 'x-user-id': USER_ID }, new Error('redis down'));
  assert.equal(await down.guard.canActivate(down.ctx), true); // fail-open, no false positives
  ok('VideoRateLimitGuard: allow+heartbeat, 429+retryAfter, 400 scope, fail-open');
}

// ---------- 6. Prisma SSOT (§4.1 Gate 1: models + indexes + back-relations) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum SecurityActionType',
    'WARNING_THROTTLE',
    'TEMPORARY_BLOCK',
    'PERMANENT_BAN',
    'model VideoStreamSession',
    'model ScraperBlacklist',
    'sessionToken      String   @unique',
    '@@index([userId, lessonId])',
    '@@index([sessionToken])',
    '@@index([ipAddress])',
    'videoStreamSessions VideoStreamSession[]',
    'scraperBlacklists   ScraperBlacklist[]',
    'streamSessions VideoStreamSession[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: SecurityActionType + VideoStreamSession + ScraperBlacklist + relations');
}

// ---------- 7. Redis additives (§5.2 pipeline + §7.1 risk/heartbeat) ----------
{
  const src = readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
  for (const t of [
    'trackVideoSegment',
    'zremrangebyscore',
    'incrementScrapingViolationScore',
    'setPlaybackHeartbeat',
    'getPlaybackHeartbeat',
    'videoRiskScoreKey',
    'videoHeartbeatKey',
  ]) {
    assert.ok(src.includes(t), `redis-cluster missing: ${t}`);
  }
  ok('RedisClusterService: sliding-window pipeline + risk score + heartbeat');
}

// ---------- 8. Static parity: controller + module + proxies + player (§5.3/§6.1) ----------
function sectionStaticParity(): void {
  const controller = readFileSync(
    'apps/backend/src/modules/stream/controllers/hls-stream.controller.ts',
    'utf8',
  );
  for (const t of [
    "Controller('api/v1/hls')",
    'playlist.m3u8',
    ':lessonId/segments/:segmentName',
    ':lessonId/key',
    ':lessonId/session',
    'UseGuards(VideoRateLimitGuard)',
    'application/x-mpegURL',
    'no-store',
  ]) {
    assert.ok(controller.includes(t), `controller missing: ${t}`);
  }
  const module = readFileSync('apps/backend/src/modules/stream/video-security.module.ts', 'utf8');
  for (const t of [
    'HlsStreamController',
    'HlsSecurityService',
    'VideoSessionService',
    'VideoRateLimitGuard',
    'useFactory',
    'PrismaService',
    'RedisClusterService',
    'R2StorageService',
  ]) {
    assert.ok(module.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('VideoSecurityModule'));

  const files: Array<[string, string[]]> = [
    ['apps/frontend/app/api/v1/hls/[lessonId]/session/route.ts', ['/api/v1/hls/', '/session', '503']],
    ['apps/frontend/app/api/v1/hls/[lessonId]/playlist/route.ts', ['playlist.m3u8', 'x-mpegURL', 'no-store']],
    [
      'apps/frontend/app/api/v1/hls/[lessonId]/segments/[segmentName]/route.ts',
      ['/segments/', '429', 'Retry-After', 'arrayBuffer', 'no-store'],
    ],
    ['apps/frontend/app/api/v1/hls/[lessonId]/key/route.ts', ['/key?', 'arrayBuffer', 'no-store']],
  ];
  for (const [f, tokens] of files) {
    const src = readFileSync(f, 'utf8');
    for (const t of tokens) assert.ok(src.includes(t), `${f} missing: ${t}`);
  }

  const player = readFileSync('apps/frontend/components/player/hls-video-player.tsx', 'utf8');
  for (const t of [
    'LIFF_INIT',
    'initialStreamToken',
    'onRateLimited',
    'maxBufferLength',
    'X-Stream-Timestamp',
    'VIDEO_TOKEN_RENEW_SEC',
    'videoBackoffMs',
    'nodownload',
    'PROTECTED CONTENT',
    'controlsList',
  ]) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  ok('Static parity: HLS controller + VideoSecurityModule + 4 proxies + secure player');
  console.log(`\nPhase 050 contracts: ${passed} groups passed.`);
}

async function main(): Promise<void> {
  await sectionSecurityService();
  await sectionSessionService();
  await sectionGuardLive();
  sectionStaticParity();
}

void main();
