// SSOT Phase 042 §10 — contract tests (Zod, crypto, entity, handler, wiring)
// Run: npx tsx scripts/test-phase042-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import {
  ForensicVerificationPayloadSchema,
  WATERMARK_EVENT_STREAM,
  WATERMARK_IDLE_AFTER_MS,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SEED_TTL_SEC,
  WATERMARK_STEGO_SIZE_PX,
  WatermarkMotionModeEnum,
  WatermarkSeedPayloadSchema,
  WatermarkViolationTypeEnum,
  lissajousPosition,
  watermarkHmacMessage,
} from '../packages/shared/src/schemas/watermark-contract';
import { WatermarkSeed } from '../apps/backend/src/modules/watermark/domain/watermark-seed.entity';
import { HmacSignature } from '../apps/backend/src/modules/watermark/domain/value-objects/hmac-signature.vo';
import { WatermarkCryptoService } from '../apps/backend/src/modules/watermark/application/services/watermark-crypto.service';
import { ForensicExtractorService } from '../apps/backend/src/modules/watermark/application/services/forensic-extractor.service';
import { WatermarkSeedRepository } from '../apps/backend/src/modules/watermark/infrastructure/repositories/watermark-seed.repository';
import { GetWatermarkSeedHandler } from '../apps/backend/src/modules/watermark/application/queries/get-watermark-seed.handler';
import { WatermarkSeedService } from '../apps/backend/src/modules/reader/watermark-seed.service';
// NOTE: WatermarkResolver/WatermarkController/WatermarkModule carry Nest
// parameter decorators which tsx/esbuild cannot transform — verified via
// static source parity (§8) following the Phase 027–041 precedent.

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const SECRET = 'test-hmac-secret-042';
const USER_ID = 'user-001';
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + motion/stego budgets ----------
{
  for (const m of ['LISSAJOUS_CURVE', 'RANDOM_BOUNCE', 'LINEAR_DIAGONAL', 'STATIC_GRID_PULSE']) {
    assert.equal(WatermarkMotionModeEnum.safeParse(m).success, true);
  }
  assert.equal(WatermarkMotionModeEnum.safeParse('SPIRAL').success, false);
  const seed = {
    seedId: '123e4567-e89b-12d3-a456-426614174000',
    userIdHash: 'a'.repeat(64),
    lineUserId: 'U123',
    displayName: 'Reader One',
    clientIp: '1.2.3.4',
    timestamp: new Date().toISOString(),
    hmacSignature: 'sig',
    config: { opacityMin: 0.12, opacityMax: 0.25, fontSizePx: 12, motionMode: 'LISSAJOUS_CURVE', steganographyEnabled: true },
  };
  assert.equal(WatermarkSeedPayloadSchema.safeParse(seed).success, true);
  assert.equal(WatermarkSeedPayloadSchema.safeParse({ ...seed, userIdHash: 'short' }).success, false);
  assert.equal(WatermarkSeedPayloadSchema.safeParse({ ...seed, config: { ...seed.config, opacityMin: 0.01 } }).success, false);
  assert.equal(WatermarkSeedPayloadSchema.safeParse({ ...seed, config: { ...seed.config, fontSizePx: 9 } }).success, false);
  const noStego = WatermarkSeedPayloadSchema.safeParse({ ...seed, config: { opacityMin: 0.12, opacityMax: 0.25, fontSizePx: 12, motionMode: 'STATIC_GRID_PULSE' } });
  assert.equal(noStego.success, true);
  if (noStego.success) assert.equal(noStego.data.config.steganographyEnabled, true);

  assert.equal(ForensicVerificationPayloadSchema.safeParse({ extractedUserIdHash: 'h', extractedLineUserId: null, extractedTimestamp: new Date().toISOString(), confidenceScore: 100, isTampered: false }).success, true);
  assert.equal(ForensicVerificationPayloadSchema.safeParse({ extractedUserIdHash: 'h', extractedLineUserId: null, extractedTimestamp: 'x', confidenceScore: 101, isTampered: false }).success, false);

  assert.equal(WATERMARK_SEED_TTL_SEC, 900);
  assert.equal(WATERMARK_STEGO_SIZE_PX, 16);
  assert.equal(WATERMARK_OPACITY_MIN, 0.12);
  assert.equal(WATERMARK_OPACITY_MAX, 0.25);
  assert.equal(WATERMARK_IDLE_AFTER_MS, 5000);
  assert.equal(WATERMARK_EVENT_STREAM, 'stream:security:watermark-events');
  for (const v of ['TAMPER_DOM', 'SCREENSHOT_DETECTED', 'DEVTOOLS_OPENED']) {
    assert.equal(WatermarkViolationTypeEnum.safeParse(v).success, true);
  }
  const p0 = lissajousPosition(0);
  assert.ok(Math.abs(p0.nx - 0.5) < 1e-9 && Math.abs(p0.ny - 0.85) < 1e-9);
  const p1 = lissajousPosition(1);
  assert.ok(p1.nx >= 0.15 && p1.nx <= 0.85 && p1.ny >= 0.15 && p1.ny <= 0.85);
  assert.equal(watermarkHmacMessage('s', 'h', 't'), 's:h:t');
  ok('Zod seed/verify verbatim + motion/stego/idle budgets + Lissajous math');
}

// ---------- 2. Entity invariants + TTL + display text ----------
{
  const base = {
    seedId: '123e4567-e89b-12d3-a456-426614174000',
    userId: USER_ID,
    productId: PRODUCT_ID,
    clientIp: '1.2.3.4',
    userIdHash: 'b'.repeat(64),
    displayName: 'Reader One',
    timestamp: new Date('2026-10-07T00:00:00.000Z').toISOString(),
    hmacSignature: 'sig',
  };
  const seed = WatermarkSeed.create(base);
  assert.ok(seed.ttlRemainingSec(Date.parse('2026-10-07T00:00:00.000Z')) === 900);
  assert.equal(seed.isExpired(Date.parse('2026-10-07T00:15:01.000Z')), true);
  assert.equal(seed.isExpired(Date.parse('2026-10-07T00:14:59.000Z')), false);
  assert.equal(seed.displayText(), 'Reader One (bbbbbbbb) - CONFIDENTIAL');
  const withLine = WatermarkSeed.create({ ...base, lineUserId: 'U123' });
  assert.equal(withLine.displayText(), 'Reader One (U123) - CONFIDENTIAL');
  assert.throws(() => WatermarkSeed.create({ ...base, seedId: 'nope' }), /seed id/);
  assert.throws(() => WatermarkSeed.create({ ...base, userIdHash: 'short' }), /hash/);
  assert.throws(() => WatermarkSeed.create({ ...base, timestamp: 'when' }), /timestamp/);
  assert.throws(() => WatermarkSeed.create({ ...base, displayName: '' }), /display name/);
  ok('Seed entity guards + 15min TTL + overlay display text');
}

// ---------- 3. HMAC VO timing-safe equality ----------
{
  const sig = HmacSignature.create('a'.repeat(64));
  assert.equal(sig.equals('a'.repeat(64)), true);
  assert.equal(sig.equals('a'.repeat(63) + 'b'), false);
  assert.equal(sig.equals('short'), false);
  assert.throws(() => HmacSignature.create('short'), /Invalid HMAC/);
  ok('HMAC VO timing-safe compare with length guard');
}

async function main(): Promise<void> {
  // ---------- 4. Crypto service (§5.2 semantics) ----------
  {
    const crypto = new WatermarkCryptoService(SECRET);
    const hash = crypto.generateUserIdHash(USER_ID);
    assert.equal(hash, createHash('sha256').update(`${USER_ID}:${SECRET}`).digest('hex'));
    assert.equal(hash.length, 64);
    const ts = new Date().toISOString();
    const sig = crypto.generateHMACSignature('seed-1', hash, ts);
    assert.equal(sig, createHmac('sha256', SECRET).update(`seed-1:${hash}:${ts}`).digest('hex'));
    assert.equal(crypto.verifyHMACSignature('seed-1', hash, ts, sig), true);
    assert.equal(crypto.verifyHMACSignature('seed-1', hash, ts, `${sig.slice(0, -1)}0`), false);
    assert.equal(crypto.verifyHMACSignature('seed-1', hash, ts, 'short'), false);
    assert.ok(/^[0-9a-f-]{36}$/.test(crypto.newSeedId()));
    ok('sha256 identity + HMAC sign/verify (timing-safe, forgery rejected)');
  }

  // ---------- 5. Handler: Zod-shaped seed + async audit + event ----------
  {
    const crypto = new WatermarkCryptoService(SECRET);
    const created: unknown[] = [];
    const repo = new WatermarkSeedRepository({
      watermarkSeedLog: {
        create: async (a: unknown) => { created.push(a); return {}; },
        findUnique: async () => null,
      },
      securityViolationLog: { create: async () => ({}) },
    } as never);
    const events: Array<{ stream: string; event: Record<string, unknown> }> = [];
    const handler = new GetWatermarkSeedHandler(crypto, repo, (stream, event) => events.push({ stream, event }));
    const payload = await handler.execute({
      userId: USER_ID,
      lineUserId: 'U123',
      displayName: 'Reader One',
      productId: PRODUCT_ID,
      clientIp: '9.9.9.9',
      userAgent: 'liff-webview/2.22',
    });
    assert.equal(WatermarkSeedPayloadSchema.safeParse(payload).success, true);
    assert.equal(payload.userIdHash, crypto.generateUserIdHash(USER_ID));
    assert.equal(payload.config.motionMode, 'LISSAJOUS_CURVE');
    assert.ok(created.length === 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].stream, WATERMARK_EVENT_STREAM);
    assert.equal((events[0].event as { type: string }).type, 'watermark.seed_issued');

    // Unwired handler fails closed with a typed error.
    await assert.rejects(() => new GetWatermarkSeedHandler().execute({ userId: USER_ID, displayName: 'x', productId: PRODUCT_ID, clientIp: '1.1.1.1', userAgent: 'u' }), /unavailable/);
    ok('Seed issuance: contract-shaped + audit row + stream event + fail-closed');
  }

  // ---------- 6. Extractor confidence ladder (100/50/0) ----------
  {
    const crypto = new WatermarkCryptoService(SECRET);
    const ts = new Date().toISOString();
    const hash = crypto.generateUserIdHash(USER_ID);
    const sig = crypto.generateHMACSignature('seed-9', hash, ts);
    const manifest = { seedId: 'seed-9', userIdHash: hash, timestamp: ts, hmacSignature: sig };

    const fresh = new ForensicExtractorService(crypto, {
      findSeedRow: async () => ({ userId: USER_ID, lineUserId: 'U123', timestamp: ts, expired: false }),
    });
    assert.deepEqual(await fresh.verify('img-bytes', manifest), {
      extractedUserIdHash: hash, extractedLineUserId: 'U123', extractedTimestamp: ts, confidenceScore: 100, isTampered: false,
    });

    const stale = new ForensicExtractorService(crypto, {
      findSeedRow: async () => ({ userId: USER_ID, lineUserId: null, timestamp: ts, expired: true }),
    });
    const staleOut = await stale.verify('img-bytes', manifest);
    assert.equal(staleOut.confidenceScore, 50);
    assert.equal(staleOut.isTampered, false);

    const forged = new ForensicExtractorService(crypto, {
      findSeedRow: async () => ({ userId: USER_ID, lineUserId: null, timestamp: ts, expired: false }),
    });
    const forgedOut = await forged.verify('img-bytes', { ...manifest, hmacSignature: '0'.repeat(64) });
    assert.equal(forgedOut.confidenceScore, 0);
    assert.equal(forgedOut.isTampered, true);

    // Hash mismatch on a live row (re-encoded swap) → tampered, never misattributed.
    const swapped = await forged.verify('img-bytes', { ...manifest, userIdHash: 'c'.repeat(64), hmacSignature: crypto.generateHMACSignature('seed-9', 'c'.repeat(64), ts) });
    assert.equal(swapped.confidenceScore, 0);
    assert.equal(swapped.isTampered, true);

    const bare = new ForensicExtractorService();
    assert.equal((await bare.verify('img-bytes', manifest)).isTampered, true);
    ok('Extractor: fresh 100 / stale 50 / forged-or-swapped 0+tampered');
  }

  // ---------- 7. Reader facade memo (15min, per user×product) ----------
  {
    const crypto = new WatermarkCryptoService(SECRET);
    const repo = new WatermarkSeedRepository(undefined);
    let calls = 0;
    const handler = new GetWatermarkSeedHandler(crypto, repo);
    const facade = new WatermarkSeedService(handler);
    const req = { userId: USER_ID, displayName: 'Reader One', productId: PRODUCT_ID, clientIp: '1.1.1.1', userAgent: 'u' };
    const first = await facade.getSeed(req);
    const second = await facade.getSeed(req);
    assert.equal(first.seedId, second.seedId); // memoized, no re-issue
    void calls;
    const later = await facade.getSeed(req, Date.now() + 901 * 1000);
    assert.notEqual(later.seedId, first.seedId); // TTL expired → re-issued
    await assert.rejects(() => new WatermarkSeedService().getSeed(req), /unavailable/);
    ok('Reader seed memo: hit within TTL, re-issue after, fail-closed unwired');
  }

  // ---------- 8. Wiring + SDL/hook/overlay/proxy parity (Gates 1/9) ----------
  {
    const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
    for (const t of ['model WatermarkSeedLog', 'model SecurityViolationLog', '@@unique', 'watermarkSeeds      WatermarkSeedLog[]', 'securityViolations  SecurityViolationLog[]', 'watermarkSeeds WatermarkSeedLog[]']) {
      assert.ok(prisma.includes(t), `prisma missing ${t}`);
    }
    const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
    for (const t of ['WatermarkSeedPayloadSchema', 'ForensicVerificationPayloadSchema', 'lissajousPosition', 'WATERMARK_STEGO_SIZE_PX', 'WATERMARK_EVENT_STREAM']) {
      assert.ok(barrel.includes(t), `shared barrel missing ${t}`);
    }
    const mod = readFileSync('apps/backend/src/modules/watermark/watermark.module.ts', 'utf8');
    for (const t of ['WatermarkCryptoService', 'WatermarkSeedRepository', 'GetWatermarkSeedHandler', 'ForensicExtractorService', 'WatermarkResolver', 'WatermarkController', 'useFactory', 'PrismaService']) {
      assert.ok(mod.includes(t), `module missing ${t}`);
    }
    assert.ok(!mod.includes("from './backend") && !mod.includes("from './workers") && !mod.includes("from '../backend"), 'stray scaffold trees stay unregistered');
    assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('WatermarkModule'));
    const rslSrc = readFileSync('apps/backend/src/modules/watermark/infrastructure/graphql/watermark.resolver.ts', 'utf8');
    for (const t of ['getWatermarkSeed', 'extractForensicWatermark', 'WatermarkSeedPayload', 'ForensicVerificationResult', '@Context', 'resolveReaderIdentity']) {
      assert.ok(rslSrc.includes(t), `resolver missing ${t}`);
    }
    const sdl = readFileSync('apps/backend/src/api/graphql/schemas/watermark.graphql/schema.graphql', 'utf8');
    for (const t of ['getWatermarkSeed', 'extractForensicWatermark', 'WatermarkSeedPayload', 'ForensicVerificationResult', 'WatermarkConfig']) {
      assert.ok(sdl.includes(t), `SDL missing ${t}`);
    }
    const ctlSrc = readFileSync('apps/backend/src/modules/watermark/infrastructure/rest/watermark.controller.ts', 'utf8');
    for (const t of ['api/v1/watermark', '@Get', '@Post', 'JwtAuthGuard', 'WatermarkViolationTypeEnum', 'logViolation']) {
      assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
    }
    const facade = readFileSync('apps/backend/src/modules/reader/watermark-seed.service.ts', 'utf8');
    assert.ok(facade.includes('GetWatermarkSeedHandler') && facade.includes('WATERMARK_SEED_TTL_SEC'));
    const hook = readFileSync('apps/frontend/hooks/useForensicWatermark.ts', 'utf8');
    for (const t of ['/api/v1/watermark/seed', 'LIFF_INIT', 'SUCCESS', 'ERROR', 'SECURITY_VIOLATION', 'WATERMARK_SEED_TTL_SEC', 'reportViolation']) {
      assert.ok(hook.includes(t), `hook missing ${t}`);
    }
    const overlay = readFileSync('apps/frontend/components/reader/ForegroundWatermarkOverlay.tsx', 'utf8');
    for (const t of ['lissajousPosition', 'attachShadow', 'MutationObserver', 'SECURITY_VIOLATION', 'putImageData', 'requestAnimationFrame', 'WATERMARK_IDLE_AFTER_MS']) {
      assert.ok(overlay.includes(t), `overlay missing ${t}`);
    }
    const video = readFileSync('apps/frontend/components/player/VideoWatermarkOverlay.tsx', 'utf8');
    assert.ok(video.includes('ForegroundWatermarkOverlay') && video.includes('steganography={false}'));
    for (const [f, markers] of [
      ['apps/frontend/app/api/v1/watermark/seed/route.ts', ['/api/v1/watermark/seed', '503']],
      ['apps/frontend/app/api/v1/watermark/violation/route.ts', ['/api/v1/watermark/violation', 'POST']],
    ] as Array<[string, string[]]>) {
      const src = readFileSync(f, 'utf8');
      for (const t of markers) assert.ok(src.includes(t), `${f} missing ${t}`);
    }
    ok('Prisma logs + barrel + module/App + resolver/SDL/controller + facade + hook/overlays/proxies parity');
  }

  console.log(`\nPhase 042 contracts: ${passed} checks passed`);
}

void main();
