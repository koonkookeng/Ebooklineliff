// SSOT Phase 032 §10 — contract tests (Zod, audit, geocode, hook/UI, wiring)
// Run: npx tsx scripts/test-phase032-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PermissionTypeEnum,
  PermissionStatusEnum,
  DevicePlatformEnum,
  PermissionRequestPayloadSchema,
  GeolocationCoordinatesSchema,
  ReverseGeocodeResultSchema,
  PermissionAuditLogSchema,
  GEOLOCATION_TIMEOUT_MS,
  GEOCODE_CACHE_TTL_SEC,
  PERMISSION_ANALYTICS_CHANNEL,
  geocodeCacheKey,
  detectDevicePlatform,
  PERMISSION_SHEET_COPY,
  SETTINGS_PATH_COPY,
} from '../packages/shared/src/schemas/permission-contract';
import { PermissionAuditService } from '../apps/backend/src/modules/permission/permission-audit.service';
import { ReverseGeocodingService } from '../apps/backend/src/modules/permission/reverse-geocoding.service';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import { stopMediaStream } from '../apps/frontend/lib/permissions/permission-client';
// NOTE: PermissionAuditController uses Nest parameter decorators (@Body/@Query)
// which tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–031 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod vocabulary + boundaries (§3.1 Gate 1) ----------
{
  for (const t of ['CAMERA', 'PHOTO_LIBRARY', 'GEOLOCATION', 'MICROPHONE']) {
    assert.equal(PermissionTypeEnum.safeParse(t).success, true);
  }
  for (const s of ['PROMPT', 'GRANTED', 'DENIED', 'RESTRICTED', 'UNSUPPORTED']) {
    assert.equal(PermissionStatusEnum.safeParse(s).success, true);
  }
  for (const p of ['IOS', 'ANDROID', 'DESKTOP_WEB', 'LINE_LIFF']) {
    assert.equal(DevicePlatformEnum.safeParse(p).success, true);
  }
  assert.equal(DevicePlatformEnum.safeParse('WINDOWS_PHONE').success, false);
  const req = { tenantId: 't', permissionType: 'CAMERA', purpose: 'slip verification flow', devicePlatform: 'LINE_LIFF' };
  assert.equal(PermissionRequestPayloadSchema.safeParse(req).success, true);
  assert.equal(PermissionRequestPayloadSchema.safeParse({ ...req, purpose: 'abc' }).success, false);
  assert.equal(PermissionRequestPayloadSchema.safeParse({ ...req, tenantId: '' }).success, false);
  assert.equal(GeolocationCoordinatesSchema.safeParse({ latitude: 13.7563, longitude: 100.5018, accuracy: 25 }).success, true);
  assert.equal(GeolocationCoordinatesSchema.safeParse({ latitude: 91, longitude: 0, accuracy: 0 }).success, false);
  assert.equal(GeolocationCoordinatesSchema.safeParse({ latitude: 0, longitude: -181, accuracy: 0 }).success, false);
  const result = { subdistrict: 'บึงพระ', district: 'เมืองพิษณุโลก', province: 'พิษณุโลก', postalCode: '65000', formattedAddress: 'ต.บึงพระ อ.เมืองพิษณุโลก จ.พิษณุโลก 65000' };
  assert.equal(ReverseGeocodeResultSchema.safeParse(result).success, true);
  assert.equal(ReverseGeocodeResultSchema.safeParse({ ...result, postalCode: '' }).success, false);
  const audit = { userId: 'u', permissionType: 'GEOLOCATION', status: 'GRANTED', requestedAt: new Date().toISOString() };
  const parsedAudit = PermissionAuditLogSchema.safeParse(audit);
  assert.equal(parsedAudit.success, true);
  if (parsedAudit.success) {
    assert.equal(parsedAudit.data.devicePlatform, 'LINE_LIFF');
    assert.equal(parsedAudit.data.purpose, 'unspecified');
  }
  assert.equal(PermissionAuditLogSchema.safeParse({ ...audit, status: 'MAYBE' }).success, false);
  assert.equal(GEOLOCATION_TIMEOUT_MS, 10000);
  assert.equal(GEOCODE_CACHE_TTL_SEC, 2592000);
  assert.equal(PERMISSION_ANALYTICS_CHANNEL, 'permission.events');
  assert.equal(geocodeCacheKey(13.75634, 100.50184), 'geo:reverse:13.756:100.502');
  assert.equal(detectDevicePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'IOS');
  assert.equal(detectDevicePlatform('Mozilla/5.0 (Linux; Android 14)', true), 'LINE_LIFF');
  assert.equal(detectDevicePlatform('Mozilla/5.0 (Windows NT 10.0)'), 'DESKTOP_WEB');
  for (const t of ['CAMERA', 'PHOTO_LIBRARY', 'GEOLOCATION', 'MICROPHONE'] as const) {
    assert.ok(PERMISSION_SHEET_COPY[t].title.length > 0 && PERMISSION_SHEET_COPY[t].benefit.length > 0);
  }
  for (const p of ['IOS', 'ANDROID', 'DESKTOP_WEB', 'LINE_LIFF'] as const) {
    assert.ok(SETTINGS_PATH_COPY[p].length > 0);
  }
  ok('Zod types/status/platform/payload/coords/result/audit + key/platform/copy constants');
}

function stubCluster(store: Map<string, string> = new Map(), published: Array<{ c: string; m: string }> = []): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (c: string, m: string) => { published.push({ c, m }); },
  } as unknown as RedisClusterService;
}

async function main(): Promise<void> {
// ---------- 2. Audit service: append + funnel events + fail-open ----------
{
  const created: unknown[] = [];
  const published: Array<{ c: string; m: string }> = [];
  const prisma = {
    permissionAuditLog: {
      create: async (a: unknown) => { created.push(a); return {}; },
      findMany: async () => [{ id: 'a1' }],
    },
  } as unknown as PrismaService;
  const svc = new PermissionAuditService(prisma, stubCluster(new Map(), published));
  const base = { userId: 'u', permissionType: 'CAMERA', requestedAt: new Date().toISOString() };
  assert.equal(await svc.logAudit({ ...base, status: 'GRANTED' }), true);
  assert.equal(await svc.logAudit({ ...base, status: 'DENIED', permissionType: 'GEOLOCATION' }), true);
  assert.equal(await svc.logAudit({ ...base, status: 'PROMPT' }), true);
  assert.equal((created[0] as { data: Record<string, unknown> }).data.ipAddress, 'unknown');
  const events = published.map((p) => (JSON.parse(p.m) as { event: string }).event);
  assert.deepEqual(events, ['permission_accepted', 'permission_denied', 'permission_prompt_impression']);
  assert.equal(published[0].c, 'permission.events');
  await assert.rejects(() => svc.logAudit({ userId: '', permissionType: 'CAMERA', status: 'GRANTED', requestedAt: new Date().toISOString() }), /Invalid permission audit/);
  assert.deepEqual(await svc.myLogs('u'), [{ id: 'a1' }]);
  await assert.rejects(() => svc.myLogs(''), /Missing user id/);

  // Total sink outage: still true (UX never blocks on audit).
  const dead = new PermissionAuditService(
    { permissionAuditLog: { create: async () => { throw new Error('db down'); }, findMany: async () => { throw new Error('db down'); } } } as unknown as PrismaService,
    { get: async () => null, setex: async () => undefined, del: async () => undefined, publish: async () => { throw new Error('redis down'); } } as unknown as RedisClusterService,
  );
  assert.equal(await dead.logAudit({ ...base, status: 'GRANTED' }), true);
  assert.deepEqual(await dead.myLogs('u'), []);
  ok('Audit appends + funnel mapping + 400s; outage fail-open');
}

// ---------- 3. Geocode service: validation, cache hit, provider, PDPA rounding ----------
{
  const RESULT = { subdistrict: 'บึงพระ', district: 'เมืองพิษณุโลก', province: 'พิษณุโลก', postalCode: '65000', formattedAddress: 'ต.บึงพระ อ.เมืองพิษณุโลก จ.พิษณุโลก 65000' };
  const realFetch = globalThis.fetch;

  // Cache hit: no provider needed, user cache upserted grid-rounded.
  const upserted: unknown[] = [];
  const hitSvc = new ReverseGeocodingService(
    { userLocationCache: { upsert: async (a: unknown) => { upserted.push(a); return {}; } } } as unknown as PrismaService,
    stubCluster(new Map([[geocodeCacheKey(13.7563, 100.5018), JSON.stringify(RESULT)]])),
  );
  const hit = await hitSvc.getAddressFromCoords('u-1', 13.7563, 100.5018);
  assert.deepEqual(hit, RESULT);
  const create = (upserted[0] as { create: Record<string, unknown> }).create;
  assert.equal(create.latitude, 13.756);
  assert.equal(create.longitude, 100.502);
  assert.equal(create.subdistrict, 'บึงพระ');

  // Validation gates.
  await assert.rejects(() => hitSvc.getAddressFromCoords('u', 91, 0), /Invalid coordinates/);
  await assert.rejects(() => hitSvc.getAddressFromCoords('', 13, 100), /Missing user id/);

  // No provider configured → 503 (never a fabricated address).
  const missSvc = new ReverseGeocodingService(
    { userLocationCache: { upsert: async () => ({}) } } as unknown as PrismaService,
    stubCluster(),
  );
  delete process.env.GEOCODE_PROVIDER_URL;
  await assert.rejects(() => missSvc.getAddressFromCoords('u', 13.7, 100.5), /not configured/);

  // Provider happy path: validates shape, warms 30d cell, remembers user.
  const store = new Map<string, string>();
  const upserted2: unknown[] = [];
  const setexCalls: Array<{ k: string; ttl: number }> = [];
  const provSvc = new ReverseGeocodingService(
    { userLocationCache: { upsert: async (a: unknown) => { upserted2.push(a); return {}; } } } as unknown as PrismaService,
    {
      get: async () => null,
      setex: async (k: string, ttl: number, v: string) => { setexCalls.push({ k, ttl }); store.set(k, v); },
      del: async () => undefined,
      publish: async () => undefined,
    } as unknown as RedisClusterService,
  );
  process.env.GEOCODE_PROVIDER_URL = 'https://gis.example.test/reverse';
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, json: async () => RESULT });
  const resolved = await provSvc.getAddressFromCoords('u-9', 13.75634, 100.50184);
  assert.deepEqual(resolved, RESULT);
  assert.equal(setexCalls[0].k, 'geo:reverse:13.756:100.502');
  assert.equal(setexCalls[0].ttl, 2592000);
  assert.equal(upserted2.length, 1);

  // Provider shape violation → 503.
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, json: async () => ({ wrong: true }) });
  await assert.rejects(() => provSvc.getAddressFromCoords('u-9', 13.7, 100.5), /unavailable/);
  (globalThis as unknown as { fetch: unknown }).fetch = async () => { throw new Error('timeout'); };
  await assert.rejects(() => provSvc.getAddressFromCoords('u-9', 13.7, 100.5), /unavailable/);
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  delete process.env.GEOCODE_PROVIDER_URL;
  ok('Geocode validates, serves cache, 503 without provider, warms cell, PDPA rounding');
}

// ---------- 4. Client media helper: stream sweep without throws ----------
{
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }, { stop: () => { throw new Error('stuck'); } }] };
  stopMediaStream(stream);
  assert.equal(stopped, 1);
  stopMediaStream(null);
  stopMediaStream(undefined);
  stopMediaStream({});
  ok('stopMediaStream sweeps tracks, survives stuck tracks and nulls');
}

// ---------- 5. Hook + sheet + dialog source: 5-state machine, PDPA, zero-dep ----------
{
  const hook = readFileSync('apps/frontend/hooks/useDevicePermissions.ts', 'utf8');
  for (const t of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR', 'PROMPT', 'GRANTED', 'DENIED', 'permissions.query', 'getCurrentPosition', 'getUserMedia', 'enableHighAccuracy: false', 'logPermissionEvent', 'stopMediaStream', 'UNSUPPORTED']) {
    assert.ok(hook.includes(t), `hook missing ${t}`);
  }
  assert.ok(!hook.includes("from 'lucide"), 'zero new deps: no lucide import');
  const sheet = readFileSync('apps/frontend/components/permissions/PrePermissionSheet.tsx', 'utf8');
  for (const t of ['PERMISSION_SHEET_COPY', 'PDPA Privacy Protected', 'ยินยอมและอนุญาต', 'role="dialog"', '<svg']) {
    assert.ok(sheet.includes(t), `sheet missing ${t}`);
  }
  assert.ok(!sheet.includes("from 'lucide") && !sheet.includes('from "lucide'), 'zero new deps: no lucide import');
  const dialog = readFileSync('apps/frontend/components/permissions/PermissionDialog.tsx', 'utf8');
  for (const t of ['PrePermissionSheet', 'SETTINGS_PATH_COPY', 'คัดลอกเส้นทาง', 'ลองอีกครั้ง', 'permission-dialog', 'copyText', 'detectDevicePlatform']) {
    assert.ok(dialog.includes(t), `dialog missing ${t}`);
  }
  ok('Hook 5-state + native probes + audit; sheet PDPA copy; dialog fallback (zero-dep)');
}

// ---------- 6. Pages + proxies: slip-upload/address composition ----------
{
  const slip = readFileSync('apps/frontend/app/(liff)/checkout/slip-upload/page.tsx', 'utf8');
  for (const t of ['SlipUploadZone', 'PermissionDialog', 'PHOTO_LIBRARY', 'CAMERA', 'orderId', 'อัปโหลดสลิปชำระเงิน', 'Suspense']) {
    assert.ok(slip.includes(t), `slip-upload page missing ${t}`);
  }
  const address = readFileSync('apps/frontend/app/(liff)/checkout/address/page.tsx', 'utf8');
  for (const t of ['GEOLOCATION', 'reverseGeocode', 'subdistrict', 'postalCode', 'address-draft', 'ไม่เก็บพิกัด', 'Suspense']) {
    assert.ok(address.includes(t), `address page missing ${t}`);
  }
  assert.ok(!address.includes('latitude') || address.includes('ไม่เก็บพิกัด'), 'PDPA note present where coords flow');
  for (const [f, marker] of [
    ['apps/frontend/app/api/v1/permission/audit/route.ts', '/api/v1/permission/audit'],
    ['apps/frontend/app/api/v1/permission/reverse-geocode/route.ts', 'Missing coordinates'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  ok('Slip-upload gallery-first + address GPS autofill + draft; proxies route');
}

// ---------- 7. Prisma + module wiring + controller/DTO parity ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum PermissionType', 'enum PermissionStatus', 'model PermissionAuditLog', 'model UserLocationCache', 'MICROPHONE', 'RESTRICTED', 'permissionAudits', 'locationCache', '@@index([permissionType])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/permission/permission.module.ts', 'utf8');
  for (const t of ['PermissionAuditService', 'ReverseGeocodingService', 'PermissionAuditController']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('PermissionModule'));
  const ctlSrc = readFileSync('apps/backend/src/modules/permission/permission-audit.controller.ts', 'utf8');
  for (const t of ['api/v1/permission', "'audit'", 'reverse-geocode', 'JwtAuthGuard', 'userId mismatch', 'x-forwarded-for']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  for (const [f, marker] of [
    ['apps/backend/src/modules/permission/dto/request-permission.dto.ts', "from '@repo/shared'"],
    ['apps/backend/src/modules/permission/dto/reverse-geocode.dto.ts', 'ReverseGeocodeResultSchema'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  ok('Prisma enums/models/relations; PermissionModule wired; controller/DTO parity');
}

console.log(`\nPhase 032 contracts: ${passed} checks passed`);
}

void main();
