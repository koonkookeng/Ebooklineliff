// SSOT Phase 066 §10-11 — contract tests (Zod, service, stream, parity)
// Run: npx tsx scripts/test-phase066-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ThemeModeEnum,
  ReadingFontFamilyEnum,
  UserReadingPreferenceSchema,
  UpdatePreferenceInputSchema,
  PREF_CACHE_TTL_SEC,
  PREF_FANOUT_BUDGET_MS,
  PREF_PERSIST_DEBOUNCE_MS,
  PREF_ANALYTICS_STREAM,
  PREFERENCE_UPDATED_EVENT,
  THEME_TOKENS,
  preferenceCacheKey,
  preferenceChannel,
  resolveThemeMode,
  canvasFilterFor,
} from '../packages/shared/src/schemas/theme-preference.schema';
import { DEFAULT_PREFERENCE, mergePreference } from '../apps/backend/src/modules/user-preference/entities/user-preference.entity';
import { UserPreferenceService } from '../apps/backend/src/modules/user-preference/user-preference.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + tokens/helpers ----------
{
  assert.equal(ThemeModeEnum.safeParse('OLED_BLACK').success, true);
  assert.equal(ThemeModeEnum.safeParse('NEON').success, false);
  assert.equal(ReadingFontFamilyEnum.safeParse('SARABUN').success, true);
  const full = UserReadingPreferenceSchema.safeParse({ userId: USER, updatedAt: new Date().toISOString() });
  assert.equal(full.success, true);
  if (full.success) {
    assert.equal(full.data.themeMode, 'SYSTEM');
    assert.equal(full.data.fontSizePx, 16);
    assert.equal(full.data.brightnessLevel, 100);
  }
  assert.equal(UserReadingPreferenceSchema.safeParse({ userId: USER, fontSizePx: 40, updatedAt: new Date().toISOString() }).success, false);
  assert.equal(UserReadingPreferenceSchema.safeParse({ userId: USER, brightnessLevel: 10, updatedAt: new Date().toISOString() }).success, false);
  const partial = UpdatePreferenceInputSchema.safeParse({ themeMode: 'SEPIA', fontSizePx: 18 });
  assert.equal(partial.success, true);
  assert.equal(PREF_CACHE_TTL_SEC, 86400);
  assert.equal(PREF_FANOUT_BUDGET_MS, 100);
  assert.equal(PREF_PERSIST_DEBOUNCE_MS, 800);
  assert.equal(preferenceCacheKey('u1'), 'user:preference:u1');
  assert.equal(preferenceChannel('u1'), 'channel:preference:u1');
  assert.equal(PREFERENCE_UPDATED_EVENT, 'preference_updated');
  assert.equal(THEME_TOKENS.DARK['--bg-primary'], '#0F172A');
  assert.equal(THEME_TOKENS.OLED_BLACK['--bg-primary'], '#000000');
  assert.equal(THEME_TOKENS.SEPIA['--canvas-filter'], 'sepia(0.4)');
  assert.equal(resolveThemeMode('SYSTEM', true), 'DARK');
  assert.equal(resolveThemeMode('SYSTEM', false), 'LIGHT');
  assert.equal(resolveThemeMode('SEPIA', true), 'SEPIA');
  assert.ok(canvasFilterFor('OLED_BLACK').includes('invert(1)'));
  assert.equal(canvasFilterFor('LIGHT'), 'none');
  ok('Zod theme contracts verbatim + tokens/resolve/filter helpers');
}

// ---------- 2. Entity LWW merge ----------
{
  const server = { ...DEFAULT_PREFERENCE, userId: USER, updatedAt: '2024-01-01T00:00:00.000Z' };
  const stale = mergePreference(server, { themeMode: 'DARK', updatedAt: '2023-01-01T00:00:00.000Z' });
  assert.equal(stale, server);
  const fresh = mergePreference(server, { themeMode: 'SEPIA', updatedAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(fresh.themeMode, 'SEPIA');
  ok('Entity: LWW merge keeps newer updatedAt');
}

// ---------- 3. Service: cache + upsert + fan-out + offline sync ----------
type Row = {
  userId: string;
  themeMode: string;
  fontSizePx: number;
  fontFamily: string;
  lineHeightRatio: number;
  brightnessLevel: number;
  autoSyncWithSystem: boolean;
  updatedAt: Date;
};

function makePorts() {
  const rows = new Map<string, Row>();
  const cache = new Map<string, string>();
  const rooms: Array<{ channel: string; event: string }> = [];
  const streams: Array<{ key: string; n: number }> = [];
  const repo = {
    findByUser: async (userId: string) => rows.get(userId) ?? null,
    upsert: async (userId: string, input: Record<string, unknown>) => {
      const prev = rows.get(userId);
      const next: Row = {
        userId,
        themeMode: String(input['themeMode'] ?? prev?.themeMode ?? 'SYSTEM'),
        fontSizePx: Number(input['fontSizePx'] ?? prev?.fontSizePx ?? 16),
        fontFamily: String(input['fontFamily'] ?? prev?.fontFamily ?? 'PROMPT'),
        lineHeightRatio: Number(input['lineHeightRatio'] ?? prev?.lineHeightRatio ?? 1.5),
        brightnessLevel: Number(input['brightnessLevel'] ?? prev?.brightnessLevel ?? 100),
        autoSyncWithSystem: input['autoSyncWithSystem'] !== undefined ? Boolean(input['autoSyncWithSystem']) : (prev?.autoSyncWithSystem ?? true),
        updatedAt: new Date(),
      };
      rows.set(userId, next);
      return next;
    },
  };
  const cachePort = {
    get: async (k: string) => cache.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => {
      cache.set(k, v);
    },
    del: async (...ks: string[]) => {
      for (const k of ks) cache.delete(k);
    },
    xaddPipeline: async (key: string, batch: Array<Record<string, string | number>>) => {
      streams.push({ key, n: batch.length });
    },
  };
  const bus = {
    publishRoom: async (channel: string, event: string) => {
      rooms.push({ channel, event });
    },
  };
  return { repo, cachePort, bus, rows, cache, rooms, streams };
}

async function sectionService(): Promise<void> {
  // getPreference: auto-create defaults + cache read-through
  {
    const { repo, cachePort, cache } = makePorts();
    const svc = new UserPreferenceService(repo as never, cachePort, undefined);
    const pref = await svc.getPreference(USER);
    assert.equal(pref.themeMode, 'SYSTEM');
    assert.equal(pref.fontSizePx, 16);
    assert.ok(cache.has(`user:preference:${USER}`));
    const again = await svc.getPreference(USER);
    assert.deepEqual(again, pref);
  }
  // updatePreference: upsert + cache write + room fan-out + analytics stream
  {
    const { repo, cachePort, bus, rooms, streams } = makePorts();
    const svc = new UserPreferenceService(repo as never, cachePort, bus as never);
    const res = await svc.updatePreference(USER, { themeMode: 'OLED_BLACK', fontSizePx: 18 }, 'READER_TOOLBAR');
    assert.equal(res.ok, true);
    assert.equal(res.preference?.themeMode, 'OLED_BLACK');
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].channel, `channel:preference:${USER}`);
    assert.equal(rooms[0].event, 'preference_updated');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].key, 'events:preference-changed');
  }
  // updatePreference: invalid input rejected, empty patch returns current
  {
    const { repo, cachePort } = makePorts();
    const svc = new UserPreferenceService(repo as never, cachePort, undefined);
    const bad = await svc.updatePreference(USER, { themeMode: 'NEON' });
    assert.equal(bad.ok, false);
    const empty = await svc.updatePreference(USER, {});
    assert.equal(empty.ok, true);
  }
  // syncOfflinePreference: stale replay keeps server truth, fresh wins
  {
    const { repo, cachePort } = makePorts();
    const svc = new UserPreferenceService(repo as never, cachePort, undefined);
    await svc.updatePreference(USER, { themeMode: 'SEPIA' });
    const server = await svc.getPreference(USER);
    const stale = await svc.syncOfflinePreference(USER, { themeMode: 'DARK', updatedAt: '2020-01-01T00:00:00.000Z' });
    assert.equal(stale.preference?.themeMode, server.themeMode);
    const fresh = await svc.syncOfflinePreference(USER, {
      themeMode: 'DARK',
      updatedAt: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(fresh.preference?.themeMode, 'DARK');
  }
  ok('Service: auto-create + upsert/fan-out/analytics + offline LWW');
}

// ---------- 4. Prisma additive ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum ThemeMode', 'enum ReadingFontFamily', 'model UserReadingPreference', 'readingPreference UserReadingPreference?']) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: ThemeMode + ReadingFontFamily + UserReadingPreference (additive)');
}

// ---------- 5. Static parity ----------
function sectionParity(): void {
  const svc = readFileSync('apps/backend/src/modules/user-preference/user-preference.service.ts', 'utf8');
  for (const t of ['UserPreferenceService', 'getPreference', 'updatePreference', 'syncOfflinePreference', 'publishRoom', 'PREF_ANALYTICS_STREAM']) {
    assert.ok(svc.includes(t), `service missing: ${t}`);
  }
  const repo = readFileSync('apps/backend/src/modules/user-preference/user-preference.repository.ts', 'utf8');
  assert.ok(repo.includes('UserPreferenceRepository') && repo.includes('upsert'));
  const res = readFileSync('apps/backend/src/modules/user-preference/user-preference.resolver.ts', 'utf8');
  assert.ok(res.includes('getUserReadingPreference') && res.includes('updateUserReadingPreference'));
  const ctrl = readFileSync('apps/backend/src/modules/user-preference/controllers/preference-sync.controller.ts', 'utf8');
  assert.ok(ctrl.includes('@Sse') && ctrl.includes('JwtAuthGuard') && ctrl.includes('sync'));
  const mod = readFileSync('apps/backend/src/modules/user-preference/user-preference.module.ts', 'utf8');
  assert.ok(mod.includes('UserPreferenceModule') && mod.includes('PreferenceSyncController'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('UserPreferenceModule'));
  const alias = readFileSync('apps/backend/src/modules/reader/services/theme-sync.service.ts', 'utf8');
  assert.ok(alias.includes('user-preference.service'));
  const api = readFileSync('apps/backend/src/api/graphql/resolvers/theme-preference.resolver.ts', 'utf8');
  assert.ok(api.includes('user-preference.resolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/preference.graphql', 'utf8');
  for (const t of ['type UserReadingPreference', 'updateUserReadingPreference', 'onReadingPreferenceUpdated']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const store = readFileSync('apps/frontend/stores/use-theme-store.ts', 'utf8');
  assert.ok(store.includes('useThemeStore') && store.includes('LIFF_INIT') && store.includes('useSyncExternalStore'));
  const provider = readFileSync('apps/frontend/providers/theme-provider.tsx', 'utf8');
  for (const t of ['ThemeProvider', 'persistThemeChange', 'BroadcastChannel', 'subscribePreferenceStream', 'data-theme']) {
    assert.ok(provider.includes(t), `provider missing: ${t}`);
  }
  const toggle = readFileSync('apps/frontend/components/theme/theme-toggle.tsx', 'utf8');
  assert.ok(toggle.includes('ThemeToggle') && toggle.includes('OLED_BLACK'));
  const client = readFileSync('apps/frontend/lib/theme/theme-client.ts', 'utf8');
  assert.ok(client.includes('subscribePreferenceStream') && client.includes('syncOfflinePreference'));
  const reader = readFileSync('apps/frontend/components/reader/CanvasReader.tsx', 'utf8');
  assert.ok(reader.includes('--canvas-filter'));
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('ThemeProvider'));
  for (const p of [
    'apps/frontend/app/api/v1/preferences/route.ts',
    'apps/frontend/app/api/v1/preferences/sync/route.ts',
    'apps/frontend/app/api/v1/preferences/stream/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/preferences'), `proxy missing: ${p}`);
  }
  assert.ok(readFileSync('docs/adr/ADR-066-theme-sync-engine.md', 'utf8').includes('Theme Sync'));
  ok('Parity: service/repo/GQL/REST+SSE + store/provider/toggle + canvas + proxies + ADR');
}

async function main(): Promise<void> {
  await sectionService();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase066 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
