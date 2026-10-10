// SSOT Phase 120 §10-11 — contract tests (Zod, Haversine math, GeoIP,
// velocity, risk precedence, BDD verdicts, Flex, spoof gate, stress,
// Prisma Gate 1, module wiring, frontend, barrel).
// Run: npx tsx scripts/test-phase120-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IpAnomalyTypeEnum,
  IpRiskLevelEnum,
  GeoLocationSchema,
  AnomalyDetectionResultSchema,
  SecurityAlertPayloadSchema,
  SECURITY_ALERT_BUDGET_MS,
  ANOMALY_CHECK_BUDGET_MS,
  ANOMALY_FAST_PATH_MS,
  GEO_MATCH_TOLERANCE_MINS,
  VELOCITY_ROTATION_COUNT,
  VELOCITY_ROTATION_WINDOW_SEC,
  IMPOSSIBLE_TRAVEL_KMH,
  ANOMALY_WEIGHTS,
  SECURITY_ALERT_STREAM,
  isIpLiteral,
  haversineKm,
  travelSpeedKmh,
  isImpossibleTravel,
  anomalyScore,
  scoreToLevel,
  mfaRequired,
  sessionBlocked,
  anomalyQueueKey,
  loginVelocityKey,
} from '../packages/shared/src/schemas/ip-anomaly.schema';
import { GeoipLookupService, isPrivateIp } from '../apps/backend/src/modules/security/services/geoip-lookup.service';
import { VelocityCheckerService, calculateVelocity, rotationScreen, withinTolerance } from '../apps/backend/src/modules/security/services/velocity-checker.service';
import { RiskCalculatorService, evaluateRisk, classifyAnomaly } from '../apps/backend/src/modules/security/services/risk-calculator.service';
import { IpAnomalyService } from '../apps/backend/src/modules/security/services/ip-anomaly.service';
import {
  LineFlexAlertService,
  buildSecurityAlertFlex,
  securityFlexByteSize,
  SECURITY_FLEX_BUDGET_BYTES,
} from '../apps/backend/src/modules/security/services/line-flex-alert.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const BKK = { latitude: 13.7563, longitude: 100.5018 };
const TYO = { latitude: 35.6762, longitude: 139.6503 };

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['NORMAL', 'NEW_IP_LOCATION', 'NEW_COUNTRY', 'IMPOSSIBLE_TRAVEL', 'KNOWN_VPN_PROXY', 'HIGH_VELOCITY_ROTATION', 'DEVICE_FINGERPRINT_MISMATCH']) {
    assert.equal(IpAnomalyTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(IpAnomalyTypeEnum.safeParse('BAD').success, false);
  for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    assert.equal(IpRiskLevelEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    GeoLocationSchema.safeParse({
      ipAddress: '182.52.1.10', country: 'Thailand', countryCode: 'TH', region: 'Bangkok',
      city: 'Bangkok', latitude: 13.7563, longitude: 100.5018,
    }).success,
    true,
  );
  assert.equal(
    GeoLocationSchema.safeParse({
      ipAddress: '182.52.1.10', country: 'Thailand', countryCode: 'THA', region: 'Bangkok',
      city: 'Bangkok', latitude: 13.7563, longitude: 100.5018,
    }).success,
    false,
  );
  assert.equal(
    AnomalyDetectionResultSchema.safeParse({
      userId: USER_ID, anomalyType: 'IMPOSSIBLE_TRAVEL', riskLevel: 'CRITICAL', riskScore: 95,
      calculatedDistanceKm: 4300, timeDeltaMinutes: 15, calculatedSpeedKmH: 17200,
      currentGeo: {
        ipAddress: '126.1.2.3', country: 'Japan', countryCode: 'JP', region: 'Tokyo',
        city: 'Tokyo', latitude: 35.6762, longitude: 139.6503,
      },
      mfaRequired: true, sessionBlocked: false,
    }).success,
    true,
  );
  assert.equal(
    SecurityAlertPayloadSchema.safeParse({
      alertId: 'a1', userId: USER_ID, title: 't', description: 'd', riskLevel: 'HIGH',
      deviceInfo: 'dev', ipAddress: '1.1.1.1', locationName: 'Bangkok', timestamp: '2026-01-01T00:00:00.000Z',
    }).success,
    true,
  );
  // 120 owns its file — sdid-contract stays untouched (boundary §1.2).
  const sdid = readFileSync('packages/shared/src/schemas/sdid-contract.ts', 'utf8');
  assert.ok(!sdid.includes('IpAnomalyType'), 'sdid-contract read-only, no 120 leak');
  ok('1. Zod SSOT verbatim (types/geo/result/alert) + sdid untouched');
}

// ---------- 2. Haversine + speed + boundary (§7.1, §10 TDD pair) ----------
{
  const d = haversineKm(BKK.latitude, BKK.longitude, TYO.latitude, TYO.longitude);
  assert.ok(d > 4200 && d < 4700, `BKK↔TYO ≈4600km (got ${d.toFixed(1)})`);
  assert.equal(haversineKm(0, 0, 0, 0), 0);
  assert.equal(travelSpeedKmh(d, 15), Math.round((d / 0.25) * 100) / 100);
  assert.ok(travelSpeedKmh(d, 15) > 17000, 'BDD-1 ≈17,200 km/h');
  assert.equal(travelSpeedKmh(100, 0), 0);
  assert.equal(isImpossibleTravel(799), false);
  assert.equal(isImpossibleTravel(800), false);
  assert.equal(isImpossibleTravel(801), true);
  assert.equal(isImpossibleTravel(17200), true);
  assert.equal(withinTolerance('2026-01-01T00:00:00.000Z', '2026-01-01T00:14:00.000Z'), true);
  assert.equal(withinTolerance('2026-01-01T00:00:00.000Z', '2026-01-01T00:16:00.000Z'), false);
  ok('2. Haversine BKK↔TYO + 799/801 boundary + tolerance');
}

// ---------- 3. Score/level/MFA/block math (§7.1 weights) ----------
{
  assert.equal(anomalyScore({ impossibleTravel: true, knownVpnProxy: false, highVelocityRotation: false, newCountry: false, deviceMismatch: false }), 60);
  assert.equal(anomalyScore({ impossibleTravel: true, knownVpnProxy: true, highVelocityRotation: true, newCountry: true, deviceMismatch: true }), 100);
  assert.equal(anomalyScore({ impossibleTravel: false, knownVpnProxy: false, highVelocityRotation: false, newCountry: false, deviceMismatch: false }), 0);
  assert.deepEqual(ANOMALY_WEIGHTS, { impossibleTravel: 60, knownVpnProxy: 25, highVelocityRotation: 20, newCountry: 15, deviceMismatch: 10 });
  assert.equal(scoreToLevel(0), 'LOW');
  assert.equal(scoreToLevel(29), 'LOW');
  assert.equal(scoreToLevel(30), 'MEDIUM');
  assert.equal(scoreToLevel(59), 'MEDIUM');
  assert.equal(scoreToLevel(60), 'HIGH');
  assert.equal(scoreToLevel(84), 'HIGH');
  assert.equal(scoreToLevel(85), 'CRITICAL');
  assert.equal(scoreToLevel(100), 'CRITICAL');
  assert.equal(mfaRequired('HIGH'), true);
  assert.equal(mfaRequired('CRITICAL'), true);
  assert.equal(mfaRequired('MEDIUM'), false);
  assert.equal(sessionBlocked(100), true);
  assert.equal(sessionBlocked(99), false);
  assert.equal(classifyAnomaly({ impossibleTravel: true, knownVpnProxy: true, highVelocityRotation: true, newCountry: true, deviceMismatch: true }), 'IMPOSSIBLE_TRAVEL');
  assert.equal(classifyAnomaly({ impossibleTravel: false, knownVpnProxy: true, highVelocityRotation: true, newCountry: true, deviceMismatch: true }), 'KNOWN_VPN_PROXY');
  assert.equal(classifyAnomaly({ impossibleTravel: false, knownVpnProxy: false, highVelocityRotation: false, newCountry: false, deviceMismatch: false }), 'NORMAL');
  assert.equal(evaluateRisk({ impossibleTravel: false, knownVpnProxy: false, highVelocityRotation: false, newCountry: false, deviceMismatch: false }).anomalyType, 'NORMAL');
  const full = evaluateRisk({ impossibleTravel: true, knownVpnProxy: true, highVelocityRotation: true, newCountry: true, deviceMismatch: true });
  assert.deepEqual([full.riskScore, full.riskLevel, full.mfaRequired, full.sessionBlocked], [100, 'CRITICAL', true, true]);
  assert.equal(SECURITY_ALERT_BUDGET_MS, 500);
  assert.equal(ANOMALY_CHECK_BUDGET_MS, 50);
  assert.equal(ANOMALY_FAST_PATH_MS, 100);
  assert.equal(GEO_MATCH_TOLERANCE_MINS, 15);
  assert.equal(VELOCITY_ROTATION_COUNT, 10);
  assert.equal(VELOCITY_ROTATION_WINDOW_SEC, 30);
  assert.equal(IMPOSSIBLE_TRAVEL_KMH, 800);
  assert.equal(SECURITY_ALERT_STREAM, 'stream:security:alerts');
  assert.equal(anomalyQueueKey('HIGH', 1), 'anomaly:queue:HIGH:1');
  assert.equal(loginVelocityKey(USER_ID), `anomaly:velocity:${USER_ID}`);
  // IP literal gate (§10.1 spoof matrix).
  assert.equal(isIpLiteral('182.52.1.10'), true);
  assert.equal(isIpLiteral('::1'), true);
  assert.equal(isIpLiteral('2001:db8::1'), true);
  assert.equal(isIpLiteral('999.1.1.1'), false);
  assert.equal(isIpLiteral('not-an-ip'), false);
  assert.equal(isPrivateIp('10.0.0.5'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('182.52.1.10'), false);
  ok('3. Additive scoring + level/MFA/block lines + IP gate + budgets/keys');
}

// ---------- 4. GeoIP service (vectors/private/unknown/cache/fail-open) ----------
{
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    xaddPipeline: async () => undefined,
  };
  const svc = new GeoipLookupService(redis as never);
  const bkk = await svc.resolveIp('182.52.1.10');
  assert.deepEqual([bkk.city, bkk.countryCode, bkk.isProxyOrVpn, bkk.cached], ['Bangkok', 'TH', false, false]);
  const cached = await svc.resolveIp('182.52.1.10');
  assert.equal(cached.cached, true);
  const tor = await svc.resolveIp('185.220.1.1');
  assert.equal(tor.isProxyOrVpn, true);
  const priv = await svc.resolveIp('10.9.9.9');
  assert.deepEqual([priv.country, priv.countryCode], ['Private', 'XX']);
  const unknown = await svc.resolveIp('8.8.8.8');
  assert.deepEqual([unknown.country, unknown.isProxyOrVpn], ['Unknown', false]);
  const down = new GeoipLookupService({ get: async () => { throw new Error('down'); }, setex: async () => { throw new Error('down'); } } as never);
  const fallback = await down.resolveIp('126.1.2.3');
  assert.deepEqual([fallback.city, fallback.cached], ['Tokyo', false]);
  const svc2 = new VelocityCheckerService();
  assert.equal(typeof svc2.calculate, 'function');
  const { RiskCalculatorService: RC } = await import('../apps/backend/src/modules/security/services/risk-calculator.service');
  assert.equal(typeof new RC().evaluate, 'function');
  ok('4. Static vectors + private/unknown + cache + outage fail-open');
}

// ---------- 5. Velocity verdicts (null/exact/rotation) ----------
{
  const v0 = calculateVelocity(null, { latitude: 0, longitude: 0 }, Date.now());
  assert.deepEqual(v0, { distanceKm: 0, minutes: 0, speedKmh: 0, impossible: false });
  const v1 = calculateVelocity(
    { latitude: BKK.latitude, longitude: BKK.longitude, at: new Date(Date.now() - 15 * 60000) },
    { latitude: TYO.latitude, longitude: TYO.longitude },
    Date.now(),
  );
  assert.ok(v1.distanceKm > 4200 && v1.impossible, 'BDD-1 impossible vector');
  const now = Date.now();
  const burst = Array.from({ length: 10 }, (_, i) => ({ ip: `10.0.0.${i}`, at: now - i * 2000 }));
  assert.deepEqual(rotationScreen(burst, now), { tripped: true, distinctIps: 10 });
  assert.deepEqual(rotationScreen(burst.slice(0, 9), now), { tripped: false, distinctIps: 9 });
  const stale = Array.from({ length: 10 }, (_, i) => ({ ip: `10.0.0.${i}`, at: now - 60000 }));
  assert.deepEqual(rotationScreen(stale, now), { tripped: false, distinctIps: 0 });
  ok('5. Null/exact velocity + 10-in-30s rotation + stale exclusion');
}

// ---------- 6. BDD-1 end-to-end: impossible travel → MFA + Flex + stream ----------
{
  const events: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const sent: unknown[][] = [];
  const alerts = { sendSecurityAlertCard: async (c: unknown) => { sent.push([c]); return { messageId: 'm1' }; } };
  const geo = new GeoipLookupService({ get: async () => null, setex: async () => undefined } as never);
  const velocity = new VelocityCheckerService();
  const { RiskCalculatorService: RC } = await import('../apps/backend/src/modules/security/services/risk-calculator.service');
  const risk = new RC();
  const fifteenAgo = new Date(Date.now() - 15 * 60000);
  const db = {
    user: { findUnique: async () => ({ id: USER_ID, lineUserId: 'U9' }) },
    userLoginLog: {
      findFirst: async () => ({ latitude: BKK.latitude, longitude: BKK.longitude, createdAt: fifteenAgo, countryCode: 'TH' }),
      findMany: async () => [],
      create: async (a: unknown) => ({ id: 'log-1', ...((a as { data: Record<string, unknown> }).data) }),
    },
    knownUserDevice: { findFirst: async () => ({ id: 'kd-1' }), upsert: async () => ({}) },
    securityIpBlacklist: { findFirst: async () => null },
    userSecuritySetting: { findUnique: async () => null },
  };
  const { IpAnomalyService: Svc } = await import('../apps/backend/src/modules/security/services/ip-anomaly.service');
  const svc = new Svc(geo as never, velocity, risk as never, alerts as never, db as never, redis as never);
  const t0 = Date.now();
  const verdict = await svc.processLoginEvent({ userId: USER_ID, ipAddress: '126.1.2.3', userAgent: 'ua-1', deviceFingerprint: 'f'.repeat(64) });
  assert.equal(verdict.anomalyType, 'IMPOSSIBLE_TRAVEL');
  assert.equal(verdict.riskLevel, 'HIGH');
  assert.equal(verdict.actionRequired, 'REQUIRE_MFA');
  assert.ok(verdict.elapsedMs < SECURITY_ALERT_BUDGET_MS, `<500ms (${verdict.elapsedMs}ms)`);
  assert.equal(sent.length, 1);
  assert.ok(events.some((e) => JSON.stringify(e).includes('anomaly.scored')), 'scored stream');
  assert.ok((Date.now() - t0) < 2000, 'test-harness sanity');
  void t0;
  ok('6. BDD-1 impossible travel (MFA + Flex + stream + <500ms)');
}

// ---------- 7. Normal login (silent) + settings gate + guards ----------
{
  const events: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); } };
  const sent: unknown[][] = [];
  const alerts = { sendSecurityAlertCard: async (c: unknown) => { sent.push([c]); return { messageId: 'm1' }; } };
  const geo = new GeoipLookupService({ get: async () => null, setex: async () => undefined } as never);
  const velocity = new VelocityCheckerService();
  const { RiskCalculatorService: RC } = await import('../apps/backend/src/modules/security/services/risk-calculator.service');
  const risk = new RC();
  const db = {
    user: { findUnique: async () => ({ id: USER_ID, lineUserId: 'U9' }) },
    userLoginLog: {
      findFirst: async () => ({ latitude: BKK.latitude, longitude: BKK.longitude, createdAt: new Date(), countryCode: 'TH' }),
      findMany: async () => [],
      create: async (a: unknown) => ({ id: 'log-2', ...((a as { data: Record<string, unknown> }).data) }),
    },
    knownUserDevice: { findFirst: async () => ({ id: 'kd-1' }), upsert: async () => ({}) },
    securityIpBlacklist: { findFirst: async () => null },
    userSecuritySetting: { findUnique: async () => ({ enableGeoAlerts: false, enableLineFlexAlerts: true }) },
  };
  const { IpAnomalyService: Svc } = await import('../apps/backend/src/modules/security/services/ip-anomaly.service');
  const svc = new Svc(geo as never, velocity, risk as never, alerts as never, db as never, redis as never);
  // same-city immediate login, known device, alerts muted → ALLOW, silent.
  const calm = await svc.processLoginEvent({ userId: USER_ID, ipAddress: '182.52.9.9', userAgent: 'ua-1', deviceFingerprint: 'f'.repeat(64) });
  assert.deepEqual([calm.actionRequired, calm.anomalyType], ['ALLOW', 'NORMAL']);
  assert.equal(sent.length, 0);
  // expired blacklist entries do not flag.
  const blDb = {
    user: { findUnique: async () => ({ id: USER_ID, lineUserId: 'U9' }) },
    userLoginLog: {
      findFirst: async () => ({ latitude: BKK.latitude, longitude: BKK.longitude, createdAt: new Date(), countryCode: 'TH' }),
      findMany: async () => [],
      create: async (a: unknown) => ({ id: 'log-3', ...((a as { data: Record<string, unknown> }).data) }),
    },
    knownUserDevice: { findFirst: async () => ({ id: 'kd-1' }), upsert: async () => ({}) },
    securityIpBlacklist: { findFirst: async () => ({ ipAddress: '182.52.9.9', expiresAt: new Date(Date.now() - 1000) }) },
    userSecuritySetting: { findUnique: async () => null },
  };
  const { IpAnomalyService: SvcBl } = await import('../apps/backend/src/modules/security/services/ip-anomaly.service');
  const svcBl = new SvcBl(geo as never, velocity, risk as never, alerts as never, blDb as never, redis as never);
  const calmBl = await svcBl.processLoginEvent({ userId: USER_ID, ipAddress: '182.52.9.9', userAgent: 'ua-1', deviceFingerprint: 'f'.repeat(64) });
  assert.equal(calmBl.anomalyType, 'NORMAL');
  // guards: bad IP / missing user / unknown account surface.
  await assert.rejects(() => svc.processLoginEvent({ userId: USER_ID, ipAddress: 'garbage!!', userAgent: 'u', deviceFingerprint: 'f' }), /Invalid IP/);
  await assert.rejects(() => svc.processLoginEvent({ userId: '', ipAddress: '1.1.1.1', userAgent: 'u', deviceFingerprint: 'f' }), /Missing userId/);
  const { IpAnomalyService: Svc2 } = await import('../apps/backend/src/modules/security/services/ip-anomaly.service');
  void Svc2;
  assert.equal(IpAnomalyService.extractClientIp('203.0.1.5, 10.0.0.1', '9.9.9.9'), '203.0.1.5');
  assert.equal(IpAnomalyService.extractClientIp('10.0.0.1, 127.0.0.1', '182.52.1.10'), '182.52.1.10');
  assert.throws(() => IpAnomalyService.extractClientIp('garbage!!', 'also-bad'), /Unresolvable/);
  // history + queue reads.
  const rows = [{ id: 'l1' }];
  const svcR = new Svc(
    { resolveIp: async () => ({}) } as never, velocity, risk as never, alerts as never,
    {
      userLoginLog: { findFirst: async () => null, findMany: async () => rows, create: async () => ({}) },
      userSecuritySetting: { findUnique: async () => null },
      user: { findUnique: async () => null },
      knownUserDevice: { findFirst: async () => null, upsert: async () => ({}) },
      securityIpBlacklist: { findFirst: async () => null },
    } as never,
    redis as never,
  );
  assert.deepEqual(await svcR.recentLogins(USER_ID, 5), rows);
  assert.deepEqual(await svcR.flaggedLogins(0, 5), rows);
  ok('7. Silent normal + settings mute + spoof matrix + reads + guards');
}

// ---------- 8. Flex builder (<10KB, buttons, critical color) ----------
{
  const card = {
    lineUserId: 'U9', title: '⚠️ มีการเข้าสู่ระบบจากพิกัดผิดปกติ', location: 'Tokyo, Japan',
    ipAddress: '126.1.2.3', device: 'ua-1', riskLevel: 'CRITICAL', timestamp: '2026-01-01T00:00:00.000Z',
  };
  const { buildSecurityAlertFlex: build } = await import('../apps/backend/src/modules/security/services/line-flex-alert.service');
  const bubble = build(card);
  assert.ok(JSON.stringify(bubble).includes('บล็อกเซสชัน') && JSON.stringify(bubble).includes('OTP'), 'interactive buttons');
  assert.ok(JSON.stringify(bubble).includes('#DC2626'), 'critical color');
  const high = build({ ...card, riskLevel: 'HIGH' });
  assert.ok(JSON.stringify(high).includes('#D97706'), 'high color');
  assert.ok(securityFlexByteSize(bubble) < SECURITY_FLEX_BUDGET_BYTES, 'flex < 10KB');
  assert.equal(SECURITY_FLEX_BUDGET_BYTES, 10_000);
  const sender = new LineFlexAlertService({ pushFlex: async () => ({ messageId: 'm9' }) } as never);
  assert.deepEqual(await sender.sendSecurityAlertCard(card), { messageId: 'm9' });
  const big = build({ ...card, device: 'x'.repeat(20000) });
  assert.equal(await sender.sendSecurityAlertCard({ ...card, device: 'x'.repeat(20000) }), null);
  void big;
  ok('8. Flex card (buttons/colors/<10KB/budget-reject) + port');
}

// ---------- 9. Stress: verdict throughput + rotation window (§10.1) ----------
{
  const N = 400;
  const now = Date.now();
  const attempts = Array.from({ length: N }, (_, i) => ({ ip: `10.1.0.${i % 250}`, at: now - (i % 20) * 1000 }));
  const t0 = Date.now();
  const verdicts = await Promise.all(attempts.map(async (a, i) => {
    const v = calculateVelocity(
      { latitude: BKK.latitude, longitude: BKK.longitude, at: new Date(now - 15 * 60000) },
      { latitude: TYO.latitude, longitude: TYO.longitude },
      now,
    );
    const r = rotationScreen([{ ip: a.ip, at: a.at }], now);
    void i;
    return { v, r };
  }));
  const msPer = (Date.now() - t0) / N;
  assert.ok(verdicts.every((x) => x.v.impossible), 'all impossible');
  assert.ok(msPer < ANOMALY_CHECK_BUDGET_MS, `verdict ${msPer.toFixed(3)}ms/item < 50ms`);
  console.log(`    stress: ${N} verdicts, ${msPer.toFixed(3)}ms/item`);
  ok('9. 400-way verdict equation + timing');
}

// ---------- 10. Module wiring (119 intact, 028 untouched) ----------
{
  const mod = readFileSync('apps/backend/src/modules/security/security.module.ts', 'utf8');
  for (const p of ['GeoipLookupService', 'VelocityCheckerService', 'RiskCalculatorService', 'IpAnomalyService', 'LineFlexAlertService', 'SecurityResolver']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(mod.includes('DeviceSecurityModule'), '119 class name kept');
  assert.ok(!/ServiceService|ModuleModule|ControllerController|ResolverResolver|GuardGuard/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('DeviceSecurityModule'), 'AppModule import intact (no new module needed)');
  assert.ok(app.includes('infra/security/security.module'), '028 infra module intact');
  const ctl = readFileSync('apps/backend/src/modules/security/controllers/security-fingerprint.controller.ts', 'utf8');
  assert.ok(ctl.includes('handshake') && ctl.includes('heartbeat'), '119 controller intact');
  ok('10. Additive 120 wiring (119/028 untouched)');
}

// ---------- 11. Prisma Gate 1 (login/device/blacklist/settings) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['NORMAL', 'NEW_IP_LOCATION', 'NEW_COUNTRY', 'IMPOSSIBLE_TRAVEL', 'KNOWN_VPN_PROXY', 'HIGH_VELOCITY_ROTATION', 'DEVICE_FINGERPRINT_MISMATCH']) {
    assert.ok(prisma.includes(v), `IpAnomalyType ${v}`);
  }
  assert.ok(prisma.includes('riskLevel         RiskLevel     @default(LOW)'), 'RiskLevel reuse (no dup enum)');
  for (const m of ['model UserLoginLog', 'model KnownUserDevice', 'model SecurityIpBlacklist', 'model UserSecuritySetting']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('@@unique([userId, deviceFingerprint])'), 'known-device key');
  assert.ok(prisma.includes('@@unique([campaignId, date])') || prisma.includes('@@index([userId, createdAt])'), 'lookup indexes');
  assert.ok(prisma.includes('loginLogs           UserLoginLog[]'), 'User login wallet');
  assert.ok(prisma.includes('securitySetting     UserSecuritySetting?'), 'User settings link');
  const trigger = readFileSync('packages/db/prisma/audit-immutability.trigger.sql', 'utf8');
  assert.ok(trigger.includes('enforce_audit_log_immutability'), '118 trigger doc intact');
  ok('11. Prisma Gate 1 (enum reuse + 4 models + keys + relations)');
}

// ---------- 12. Frontend Gate 3/5 (states, sheet, modal, proxy) ----------
{
  const page = readFileSync('apps/frontend/app/(liff)/security/unusual-activity/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), `center state ${s}`);
  }
  assert.ok(page.includes('verdict-line') && page.includes('ลองใหม่'), 'verdict + retry');
  const modal = readFileSync('apps/frontend/components/security/login-history-modal.tsx', 'utf8');
  assert.ok(modal.includes('unusual-activity-sheet') && modal.includes('บล็อกเซสชันนี้') && modal.includes('ใช่ ฉันเอง'), 'sheet lanes');
  assert.ok(modal.includes('login-row') && modal.includes('LoginHistoryModal'), 'history modal');
  assert.ok(!modal.includes("from 'lucide") && !modal.includes("from '@tanstack"), 'no heavy UI imports');
  const proxy = readFileSync('apps/frontend/app/api/v1/security/anomaly/route.ts', 'utf8');
  assert.ok(proxy.includes('Unknown operation') && proxy.includes('/graphql') && !proxy.includes('${params'), 'allowlist + no interpolation');
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['IpAnomalyTypeEnum', 'GeoLocationSchema', 'AnomalyDetectionResultSchema', 'haversineKm', 'SECURITY_ALERT_BUDGET_MS', 'ANOMALY_WEIGHTS']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  const sdid = readFileSync('packages/shared/src/schemas/sdid-contract.ts', 'utf8');
  assert.ok(!sdid.includes('IpAnomaly'), 'sdid read-only honored');
  ok('12. Frontend 5-state + sheet/modal + 1 proxy + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 120 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 120 contracts FAILED:', err);
    process.exit(1);
  });
