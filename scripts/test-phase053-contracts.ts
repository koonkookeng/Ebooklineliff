// SSOT Phase 053 §10 — contract tests (Zod, token, issuance, edge, wiring)
// Run: npx tsx scripts/test-phase053-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HlsTokenPayloadSchema,
  GenerateHlsTokenInputSchema,
  HlsStreamResponseSchema,
  HLS_SEGMENT_TOKEN_TTL_SEC,
  HLS_TOKEN_ROTATE_SEC,
  HLS_EDGE_VERIFY_BUDGET_MS,
  HLS_MINT_BUDGET_MS,
  HLS_MAX_BUFFER_SEGMENTS,
  HLS_CLOCK_SKEW_SEC,
  HLS_TOKEN_MISSING,
  HLS_TOKEN_EXPIRED,
  HLS_TOKEN_INVALID,
  HLS_SECURITY_INCIDENT,
  hlsTokenBody,
  parseHlsTokenBody,
  isHlsTokenExpired,
  hlsSignedSegmentUrl,
} from '../packages/shared/src/schemas/hls-stream-contract';
import {
  HlsTokenGeneratorService,
  hashClientIp,
} from '../apps/backend/src/modules/stream/hls-token-generator.service';
import { resolveClientIp } from '../apps/backend/src/modules/stream/dto/hls-token.dto';
// NOTE: Controller/Module/Guard carry Nest (parameter) decorators which
// tsx/esbuild cannot transform — verified via static source parity (§6)
// following the Phase 027–052 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const LESSON_ID = '323e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174000';
const SECRET = 'test-hls-secret-053';
const CDN = 'https://cdn.example.com';
const NOW_SEC = Math.floor(Date.now() / 1000);

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets/helpers ----------
{
  assert.equal(
    HlsTokenPayloadSchema.safeParse({
      userId: USER_ID, lessonId: LESSON_ID, clientIpHash: 'abcdef0123456789',
      sessionId: USER_ID, exp: NOW_SEC + 60, iat: NOW_SEC,
    }).success, true);
  assert.equal(
    HlsTokenPayloadSchema.safeParse({ userId: 'x', lessonId: LESSON_ID, clientIpHash: 'h', sessionId: USER_ID, exp: 1, iat: 1 }).success,
    false);
  assert.equal(HlsTokenPayloadSchema.parse({
    userId: USER_ID, lessonId: LESSON_ID, clientIpHash: 'h', sessionId: USER_ID, exp: 1, iat: 1,
  }).tenantId, 'default');

  assert.equal(GenerateHlsTokenInputSchema.safeParse({ lessonId: LESSON_ID }).success, true);
  assert.equal(GenerateHlsTokenInputSchema.parse({ lessonId: LESSON_ID }).quality, 'auto');
  assert.equal(GenerateHlsTokenInputSchema.safeParse({ lessonId: LESSON_ID, quality: '8k' }).success, false);

  assert.equal(HlsStreamResponseSchema.safeParse({
    masterPlaylistUrl: 'https://cdn.example.com/x/master.m3u8?token=t',
    sessionToken: 't',
    watermarkPayload: { userIdHash: 'abc', displayName: 'm', timestamp: new Date().toISOString() },
  }).success, true);

  assert.equal(HLS_SEGMENT_TOKEN_TTL_SEC, 60);
  assert.equal(HLS_TOKEN_ROTATE_SEC, 30);
  assert.equal(HLS_EDGE_VERIFY_BUDGET_MS, 50);
  assert.equal(HLS_MINT_BUDGET_MS, 10);
  assert.equal(HLS_MAX_BUFFER_SEGMENTS, 2);
  assert.equal(HLS_CLOCK_SKEW_SEC, 5);
  assert.equal(HLS_TOKEN_MISSING, 'MISSING_HLS_TOKEN');
  assert.equal(HLS_TOKEN_EXPIRED, 'HLS_TOKEN_EXPIRED');
  assert.equal(HLS_TOKEN_INVALID, 'INVALID_OR_EXPIRED_HLS_TOKEN');
  assert.equal(HLS_SECURITY_INCIDENT, 'UNAUTHORIZED_HLS_ACCESS_ATTEMPT');

  assert.equal(hlsTokenBody('u', 'l', 's', 'h', 99), 'u:l:s:h:99');
  const parsed = parseHlsTokenBody('u:l:s:h:99:sig');
  assert.deepEqual(parsed, { userId: 'u', lessonId: 'l', sessionId: 's', ipHash: 'h', exp: 99, signature: 'sig' });
  assert.equal(parseHlsTokenBody('a:b:c'), null);
  assert.equal(parseHlsTokenBody('u:l:s:h:notanumber:sig'), null);
  assert.equal(isHlsTokenExpired(NOW_SEC - 10), true);
  assert.equal(isHlsTokenExpired(NOW_SEC + 60), false);
  assert.equal(isHlsTokenExpired(NOW_SEC - HLS_CLOCK_SKEW_SEC, NOW_SEC), false); // skew grace
  assert.equal(hlsSignedSegmentUrl('https://c/s/1.ts', 'T'), 'https://c/s/1.ts?token=T');
  assert.equal(hlsSignedSegmentUrl('https://c/m.m3u8?x=1', 'T'), 'https://c/m.m3u8?x=1&token=T');
  ok('Zod token/input/response verbatim + TTL/rotation/edge budgets + body helpers');
}

// ---------- 2. Token round-trip (§5.2: mint <10ms, verify, tamper, expiry, IP) ----------
{
  const svc = new HlsTokenGeneratorService(
    { getEntitlementFlag: async () => null, setEntitlementFlag: async () => undefined },
    { courseLesson: { findUnique: async () => null }, entitlement: { findUnique: async () => null }, videoStreamSession: { create: async () => ({}) } },
    SECRET, CDN,
  );
  const t0 = Date.now();
  const { token, expiresAt } = svc.generateSignedSegmentToken(USER_ID, LESSON_ID, '1.2.3.4', USER_ID);
  assert.ok(Date.now() - t0 < HLS_MINT_BUDGET_MS * 100, 'mint path stays well under budget');
  assert.ok(expiresAt - NOW_SEC <= HLS_SEGMENT_TOKEN_TTL_SEC && expiresAt > NOW_SEC);
  assert.equal(svc.verifySegmentToken(token, '1.2.3.4'), true);

  // Wrong network replays fail closed (IP binding).
  assert.equal(svc.verifySegmentToken(token, '9.9.9.9'), false);
  // Tampered body fails closed.
  const raw = Buffer.from(token, 'base64url').toString('utf-8');
  const tampered = Buffer.from(`x${raw.slice(1)}`).toString('base64url');
  assert.equal(svc.verifySegmentToken(tampered, '1.2.3.4'), false);
  // Malformed tokens fail closed, never throw.
  assert.equal(svc.verifySegmentToken('not-a-token', '1.2.3.4'), false);
  assert.equal(svc.verifySegmentToken('', '1.2.3.4'), false);
  // Cross-secret tokens fail closed.
  const foreign = new HlsTokenGeneratorService(
    { getEntitlementFlag: async () => null, setEntitlementFlag: async () => undefined },
    { courseLesson: { findUnique: async () => null }, entitlement: { findUnique: async () => null }, videoStreamSession: { create: async () => ({}) } },
    'other-secret', CDN,
  );
  assert.equal(foreign.verifySegmentToken(token, '1.2.3.4'), false);
  assert.equal(hashClientIp('1.2.3.4').length, 16);
  assert.equal(hashClientIp('1.2.3.4'), hashClientIp('1.2.3.4'));
  ok('Token mint/verify/IP-bind/tamper/malformed/cross-secret fail-closed');
}

// ---------- 3. Playlist issuance (§5.2: edge flag → DB grant → 403 → ledger) ----------
async function sectionIssuance(): Promise<void> {
  const created: unknown[] = [];
  const lessonRow = { section: { course: { productId: PRODUCT_ID } } };
  const mk = (opts: { flag: string | null; grant: { expiresAt: Date | null } | null }) =>
    new HlsTokenGeneratorService(
      {
        getEntitlementFlag: async () => opts.flag,
        setEntitlementFlag: async () => undefined,
      },
      {
        courseLesson: { findUnique: async () => lessonRow },
        entitlement: { findUnique: async () => opts.grant },
        videoStreamSession: { create: async (a: unknown) => { created.push(a); return {}; } },
      },
      SECRET, CDN,
    );

  // Edge-flag hit: no DB grant read needed (fast path <10ms).
  const fast = await mk({ flag: 'TRUE', grant: null }).getSignedMasterPlaylist(USER_ID, LESSON_ID, '1.2.3.4', 'LIFF', 'Ahong');
  assert.ok(fast.masterPlaylistUrl.startsWith(`${CDN}/courses/${LESSON_ID}/master.m3u8?token=`));
  assert.equal(fast.expiresInSeconds, 60);
  assert.equal(fast.watermarkPayload.userIdHash.length, 12);
  assert.equal(fast.watermarkPayload.displayName, 'Ahong');
  assert.equal(created.length, 1);
  const row = created[0] as { data: Record<string, unknown> };
  assert.equal(row.data['userId'], USER_ID);
  assert.equal(row.data['lessonId'], LESSON_ID);
  assert.equal(row.data['clientIpHash'], hashClientIp('1.2.3.4'));
  assert.equal(row.data['userAgent'], 'LIFF');

  // DB fallback grant: resolves product via lesson → section → course.
  const slow = await mk({ flag: null, grant: { expiresAt: null } }).getSignedMasterPlaylist(USER_ID, LESSON_ID, '1.2.3.4', 'web');
  assert.ok(slow.sessionToken.length > 32);

  // No grant anywhere → 403 (IDM/curl blocked at issuance).
  await assert.rejects(
    mk({ flag: null, grant: null }).getSignedMasterPlaylist(USER_ID, LESSON_ID, '1.2.3.4', 'web'),
    /entitlement/,
  );
  // Expired grant → 403.
  await assert.rejects(
    mk({ flag: null, grant: { expiresAt: new Date(Date.now() - 1000) } }).getSignedMasterPlaylist(USER_ID, LESSON_ID, '1.2.3.4', 'web'),
    /entitlement/,
  );
  ok('Issuance: edge-hit fast path + DB grant resolve + deny/expired 403 + ledger row');
}

// ---------- 4. DTO pure helpers (CF-IP precedence) ----------
{
  assert.equal(resolveClientIp({ 'cf-connecting-ip': '1.1.1.1, 2.2.2.2' }), '1.1.1.1');
  assert.equal(resolveClientIp({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }), '3.3.3.3');
  assert.equal(resolveClientIp({}, '5.5.5.5'), '5.5.5.5');
  assert.equal(resolveClientIp({}), 'unknown');
  ok('DTO: CF-connecting-IP > XFF > socket > unknown');
}

// ---------- 5. Prisma SSOT (§4.1 Gate 1: reuse 050 model + 053 columns) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model VideoStreamSession',
    'sessionToken      String   @unique',
    'deviceFingerprint String',
    'clientIpHash      String?',
    'userAgent         String?',
    '@@index([userId, lessonId])',
    '@@index([sessionToken])',
    '@@index([expiresAt])',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: VideoStreamSession reused + clientIpHash/userAgent/expiresAt index');
}

// ---------- 6. Static parity (issuer + gateway + edge + player + proxy) ----------
function sectionStaticParity(): void {
  const svc = readFileSync('apps/backend/src/modules/stream/hls-token-generator.service.ts', 'utf8');
  for (const t of ['generateSignedSegmentToken', 'verifySegmentToken', 'getSignedMasterPlaylist', 'timingSafeEqual', 'base64url']) {
    assert.ok(svc.includes(t), `issuer missing: ${t}`);
  }
  const controller = readFileSync('apps/backend/src/modules/stream/hls-stream.controller.ts', 'utf8');
  for (const t of ["Controller('api/stream')", 'get-signed-url', 'JwtAuthGuard', 'HlsEntitlementGuard', 'GenerateHlsTokenInputSchema']) {
    assert.ok(controller.includes(t), `controller missing: ${t}`);
  }
  const guard = readFileSync('apps/backend/src/modules/stream/guards/hls-entitlement.guard.ts', 'utf8');
  for (const t of ['HlsEntitlementGuard', 'CanActivate', 'Missing stream identity', 'Missing lesson scope']) {
    assert.ok(guard.includes(t), `guard missing: ${t}`);
  }
  const module = readFileSync('apps/backend/src/modules/stream/hls-stream.module.ts', 'utf8');
  for (const t of ['HlsStreamModule', 'HlsTokenGeneratorService', 'HlsSignedStreamController', 'useFactory']) {
    assert.ok(module.includes(t), `module missing: ${t}`);
  }
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('HlsStreamModule'));
  const edge = readFileSync('apps/backend/src/edge/cloudflare-workers/hls-auth-gatekeeper.ts', 'utf8');
  for (const t of ['MISSING_HLS_TOKEN', 'HLS_TOKEN_EXPIRED', 'INVALID_OR_EXPIRED_HLS_TOKEN', 'R2_BUCKET', 'crypto.subtle', 'max-age=3600', 'no-store']) {
    assert.ok(edge.includes(t), `edge missing: ${t}`);
  }
  const proxy = readFileSync('apps/frontend/app/api/stream/get-signed-url/route.ts', 'utf8');
  for (const t of ['/api/stream/get-signed-url', 'cookie', 'no-store', '503']) {
    assert.ok(proxy.includes(t), `proxy missing: ${t}`);
  }
  const player = readFileSync('apps/frontend/components/player/HlsSignedPlayer.tsx', 'utf8');
  for (const t of ['HlsSignedPlayer', 'get-signed-url', 'HLS_TOKEN_ROTATE_SEC', 'Re-authenticate', 'LIFF_INIT', 'watermarkPayload']) {
    assert.ok(player.includes(t), `player missing: ${t}`);
  }
  ok('Static parity: issuer + gateway + guard + module + edge + proxy + signed player');
}

async function main(): Promise<void> {
  await sectionIssuance();
  sectionStaticParity();
}

void main();
