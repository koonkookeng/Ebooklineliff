// SSOT Phase 027 §10 — contract tests (Zod, service, guard, resolver, store, SDL, UI)
// Run: npx tsx scripts/test-phase027-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NavigationStackItemSchema,
  NavigationStateSchema,
  NavigationSyncPayloadSchema,
  NavUiStateEnum,
  NavDropOffEventSchema,
  NAV_STACK_MAX_DEPTH,
  NAV_SNAPSHOT_MAX_BYTES,
  NAV_SESSION_TTL_SEC,
  NAV_DROP_OFF_CHANNEL,
  navSessionKey,
  deriveNavUiState,
} from '../packages/shared/src/schemas/navigation.schema';
import { NavigationService } from '../apps/backend/src/modules/navigation/navigation.service';
import { LiffSessionGuard } from '../apps/backend/src/modules/navigation/guards/liff-session.guard';
// NOTE: NavigationResolver/Controller use Nest parameter decorators (@Args/@Body),
// which tsx/esbuild cannot transform — they are verified via static source parity
// (§6b/§8) following the Phase 026 precedent (SDL/code-first parity, no import).
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
import {
  pushRoute,
  popRoute,
  setDirtyState,
  setModalOpen,
  closeModal,
  requestExit,
  cancelExit,
  resetNavigation,
  setShellReady,
  getNavigationSnapshot,
  getNavUiState,
} from '../apps/frontend/stores/use-navigation-store';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
function item(pathname: string) {
  return { id: UUID, pathname, searchParams: {}, timestamp: 1700000000000, isDirty: false };
}
function snapshotJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    tenantId: 'default',
    currentRoute: '/catalog',
    canGoBack: false,
    stackDepth: 1,
    isModalOpen: false,
    activeModalId: null,
    isDirtyState: false,
    historyStack: [],
    ...over,
  });
}

// ---------- 1. Zod vocabulary + boundaries (§3.1 Gate 1) ----------
{
  assert.equal(NavigationStackItemSchema.safeParse(item('/catalog')).success, true);
  assert.equal(NavigationStackItemSchema.safeParse({ ...item('/catalog'), id: 'nope' }).success, false);
  // Hook offline fallback id (newStackId) must satisfy the uuid gate or save 400s.
  const fallbackId = `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
  assert.equal(NavigationStackItemSchema.safeParse({ ...item('/x'), id: fallbackId }).success, true);
  assert.equal(NavigationStackItemSchema.safeParse(item('/../etc')).success, false);
  assert.equal(
    NavigationStateSchema.safeParse({ tenantId: 'default', currentRoute: '/catalog', canGoBack: false, stackDepth: 1 }).success,
    true,
  );
  assert.equal(
    NavigationStateSchema.safeParse({ tenantId: '', currentRoute: '/catalog', canGoBack: false, stackDepth: 1 }).success,
    false,
  );
  assert.equal(
    NavigationStateSchema.safeParse({ tenantId: 't', currentRoute: 'no-slash', canGoBack: false, stackDepth: 1 }).success,
    false,
  );
  const good = { userId: 'u-1', lineUserId: 'line-1', lastPathname: '/checkout/pay', stateSnapshotJson: snapshotJson() };
  assert.equal(NavigationSyncPayloadSchema.safeParse(good).success, true);
  assert.equal(NavigationSyncPayloadSchema.safeParse({ ...good, lastPathname: '/../x' }).success, false);
  assert.equal(NavigationSyncPayloadSchema.safeParse({ ...good, stateSnapshotJson: 'x'.repeat(NAV_SNAPSHOT_MAX_BYTES + 1) }).success, false);
  for (const s of ['LIFF_SHELL_INIT', 'ROOT_STACK', 'SUB_STACK', 'MODAL_DRAWER_ACTIVE', 'DIRTY_STATE_GUARD']) {
    assert.equal(NavUiStateEnum.safeParse(s).success, true);
  }
  assert.equal(
    NavDropOffEventSchema.safeParse({ event: 'nav.drop_off_detected', userId: 'u', tenantId: 't', pathname: '/', reason: 'ROOT_CLOSE', at: 1 }).success,
    true,
  );
  assert.equal(NAV_STACK_MAX_DEPTH, 50);
  assert.equal(NAV_SNAPSHOT_MAX_BYTES, 32768);
  assert.equal(NAV_SESSION_TTL_SEC, 2592000);
  assert.equal(NAV_DROP_OFF_CHANNEL, 'navigation.drop_off_detected');
  assert.equal(navSessionKey('u-1'), 'navigation:session:u-1');
  assert.equal(deriveNavUiState({ shellReady: false, isModalOpen: false, isDirtyState: false, stackDepth: 1 }), 'LIFF_SHELL_INIT');
  assert.equal(deriveNavUiState({ shellReady: true, isModalOpen: true, isDirtyState: true, stackDepth: 5 }), 'MODAL_DRAWER_ACTIVE');
  assert.equal(deriveNavUiState({ shellReady: true, isModalOpen: false, isDirtyState: true, stackDepth: 5 }), 'DIRTY_STATE_GUARD');
  assert.equal(deriveNavUiState({ shellReady: true, isModalOpen: false, isDirtyState: false, stackDepth: 3 }), 'SUB_STACK');
  assert.equal(deriveNavUiState({ shellReady: true, isModalOpen: false, isDirtyState: false, stackDepth: 1 }), 'ROOT_STACK');
  ok('Zod stack/state/sync/drop-off boundaries + 5-state derivation + constants');
}

function stubRedis(over: Record<string, unknown> = {}): RedisClusterService {
  return {
    get: async () => null,
    setex: async () => undefined,
    del: async () => undefined,
    publish: async () => undefined,
    ...over,
  } as unknown as RedisClusterService;
}

function stubPrisma(over: Record<string, unknown> = {}): PrismaService {
  return {
    userNavigationSession: {
      upsert: async () => ({}),
      findUnique: async () => null,
      deleteMany: async () => ({}),
    },
    ...over,
  } as unknown as PrismaService;
}

async function main(): Promise<void> {
// ---------- 2. saveSession: happy + 400s + stack cap (Gate 7) ----------
{
  let upsertArg: { update: { stackDepth: number; stateSnapshotJson: { historyStack: unknown[] } } } | null = null;
  let cached: { key: string; ttl: number } | null = null;
  const prisma = stubPrisma({
    userNavigationSession: {
      upsert: async (args: typeof upsertArg) => { upsertArg = args; return {}; },
    },
  });
  const redis = stubRedis({
    setex: async (key: string, ttl: number) => { cached = { key, ttl }; },
  });
  const svc = new NavigationService(prisma, redis);
  assert.equal(svc.sessionKey('u-9'), 'navigation:session:u-9');
  const big = Array.from({ length: 80 }, (_, i) => item(`/p-${i}`));
  const res = await svc.saveSession({ userId: 'u-9', lineUserId: 'line-9', lastPathname: '/catalog', stateSnapshotJson: snapshotJson({ stackDepth: 80, historyStack: big }) });
  assert.equal(res, true);
  assert.equal(upsertArg?.update.stackDepth, 50);
  assert.equal(upsertArg?.update.stateSnapshotJson.historyStack.length, 50);
  assert.equal(cached?.key, 'navigation:session:u-9');
  assert.equal(cached?.ttl, 2592000);
  await assert.rejects(() => svc.saveSession({ userId: '', lineUserId: 'l', lastPathname: '/', stateSnapshotJson: snapshotJson() }), /Invalid navigation sync/);
  await assert.rejects(() => svc.saveSession({ userId: 'u', lineUserId: 'l', lastPathname: '/../evil', stateSnapshotJson: snapshotJson() }), /Invalid navigation sync/);
  // Non-JSON snapshot self-heals to defaults (edge-tolerant, no throw).
  assert.equal(await svc.saveSession({ userId: 'u', lineUserId: 'l', lastPathname: '/', stateSnapshotJson: 'not-json{{' }), true);
  // Poisoned history item (traversal path) → 400 Invalid state snapshot.
  const poisoned = snapshotJson({ historyStack: [{ id: 'bad', pathname: '/../evil', searchParams: {}, timestamp: 1, isDirty: false }] });
  await assert.rejects(() => svc.saveSession({ userId: 'u', lineUserId: 'l', lastPathname: '/', stateSnapshotJson: poisoned }), /Invalid navigation state/);
  ok('Save: atomic upsert + 50-cap GC + 30d edge cache; 400 bad payload/path/snapshot');
}

// ---------- 3. getSession: edge hit → DB row → miss (Gate 7) ----------
{
  const edge = new NavigationService(stubPrisma(), stubRedis({ get: async () => snapshotJson({ currentRoute: '/catalog/ebook-123', canGoBack: true, stackDepth: 2 }) }));
  const hit = await edge.getSession('u-1');
  assert.equal(hit.found, true);
  assert.equal(hit.lastPathname, '/catalog/ebook-123');
  assert.equal(hit.payload?.canGoBack, true);

  const corrupt = new NavigationService(
    stubPrisma({ userNavigationSession: { findUnique: async () => ({ lastPathname: '/library', stateSnapshotJson: { tenantId: 't', currentRoute: '/library', canGoBack: false, stackDepth: 1, isDirtyState: false, historyStack: [] } }) } }),
    stubRedis({ get: async () => 'corrupt{{{' }),
  );
  const healed = await corrupt.getSession('u-2');
  assert.equal(healed.found, true);
  assert.equal(healed.lastPathname, '/library');

  const miss = new NavigationService(stubPrisma(), stubRedis());
  assert.deepEqual(await miss.getSession('ghost'), { found: false, lastPathname: null, payload: null });
  await assert.rejects(() => miss.getSession(''), /Missing user id/);
  ok('Restore: edge-first hit, corrupt self-heal via DB, miss envelope, 400 empty id');
}

// ---------- 4. clearSession + recordDropOff (§7.1/§8.1) ----------
{
  let deleted: unknown = null;
  let delKey: string | null = null;
  const svc = new NavigationService(
    stubPrisma({ userNavigationSession: { deleteMany: async (args: unknown) => { deleted = args; return {}; } } }),
    stubRedis({ del: async (k: string) => { delKey = k; } }),
  );
  assert.equal(await svc.clearSession('u-3'), true);
  assert.deepEqual(deleted, { where: { userId: 'u-3' } });
  assert.equal(delKey, 'navigation:session:u-3');
  await assert.rejects(() => svc.clearSession(''), /Missing user id/);

  const published: string[] = [];
  const tel = new NavigationService(stubPrisma(), stubRedis({ publish: async (_c: string, m: string) => { published.push(m); } }));
  assert.equal(await tel.recordDropOff({ event: 'nav.drop_off_detected', userId: 'u', tenantId: 't', pathname: '/checkout/pay', reason: 'DIRTY_CONFIRMED_EXIT', at: 5 }), true);
  assert.ok(published[0].includes('DIRTY_CONFIRMED_EXIT'));
  await assert.rejects(() => tel.recordDropOff({ event: 'nope' }), /Invalid drop-off/);
  ok('Clear drops row + edge; drop-off publishes validated event, 400 otherwise');
}

// ---------- 5. LiffSessionGuard: signals pass, anonymous 401 ----------
{
  const guard = new LiffSessionGuard();
  const ctxOf = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
  assert.equal(guard.canActivate(ctxOf({ user: { id: 'u' }, headers: {} })), true);
  assert.equal(guard.canActivate(ctxOf({ headers: { authorization: 'Bearer abc123' } })), true);
  assert.equal(guard.canActivate(ctxOf({ headers: { 'x-liff-id': 'liff-x' } })), true);
  assert.equal(guard.canActivate(ctxOf({ headers: { 'x-line-user-id': 'U123' } })), true);
  assert.throws(() => guard.canActivate(ctxOf({ headers: {} })), /Missing LIFF session/);
  ok('Guard passes JWT/liff-id/line-user signals, 401 anonymous');
}

// ---------- 6. Resolver/Controller static parity (no tsx import: param decorators) ----------
{
  const resolverSrc = readFileSync('apps/backend/src/modules/navigation/navigation.resolver.ts', 'utf8');
  for (const marker of ['getNavigationSession', 'syncNavigationSession', 'clearNavigationSession', 'Missing user id', 'lastPathname']) {
    assert.ok(resolverSrc.includes(marker), `resolver missing ${marker}`);
  }
  const ctlSrc = readFileSync('apps/backend/src/modules/navigation/navigation.controller.ts', 'utf8');
  for (const marker of ['api/v1/navigation', 'syncSession', 'restoreSession', 'clearSession', 'dropOff', 'JwtAuthGuard', 'LiffSessionGuard', 'mismatch', 'Unauthorized']) {
    assert.ok(ctlSrc.includes(marker), `controller missing ${marker}`);
  }
  // Identity-binding semantics live in the service (covered §2-4); here assert the
  // controller's actor() rule textually: JWT wins, mismatch 400s, anonymous 401s.
  assert.ok(ctlSrc.includes('userId mismatch with session identity'));
  // DTO re-export gate: no forked shapes.
  const dtoSrc = readFileSync('apps/backend/src/modules/navigation/dto/sync-navigation.dto.ts', 'utf8');
  assert.ok(dtoSrc.includes('NavigationSyncPayloadSchema') && dtoSrc.includes("from '@repo/shared'"));
  ok('Resolver/controller source parity + identity rules + DTO SSOT re-export');
}

// ---------- 7. Store: push/pop GC + modal/dirty/exit + 5-state (§2.2/§6.2) ----------
{
  resetNavigation();
  pushRoute('/a');
  pushRoute('/b');
  let s = getNavigationSnapshot();
  assert.deepEqual(s.historyStack, ['/a', '/b']);
  assert.equal(s.canGoBack, true);
  assert.equal(popRoute(), true);
  s = getNavigationSnapshot();
  assert.deepEqual(s.historyStack, ['/a']);
  assert.equal(popRoute(), false);
  assert.equal(getNavigationSnapshot().canGoBack, false);

  resetNavigation();
  for (let i = 0; i < 60; i++) pushRoute(`/p-${i}`);
  assert.equal(getNavigationSnapshot().historyStack.length, 50);
  assert.ok(getNavigationSnapshot().historyStack[49].includes('p-59'));

  setModalOpen(true, 'exit-confirm');
  assert.equal(getNavigationSnapshot().isModalOpen, true);
  assert.equal(getNavigationSnapshot().activeModalId, 'exit-confirm');
  closeModal();
  assert.equal(getNavigationSnapshot().isModalOpen, false);

  resetNavigation();
  assert.equal(getNavUiState(), 'LIFF_SHELL_INIT');
  setShellReady(true);
  assert.equal(getNavUiState(), 'ROOT_STACK');
  pushRoute('/x');
  pushRoute('/y');
  assert.equal(getNavUiState(), 'SUB_STACK');
  setDirtyState(true);
  assert.equal(getNavUiState(), 'DIRTY_STATE_GUARD');
  setModalOpen(true);
  assert.equal(getNavUiState(), 'MODAL_DRAWER_ACTIVE');
  requestExit('CLOSE');
  assert.equal(getNavigationSnapshot().pendingExit?.kind, 'CLOSE');
  cancelExit();
  assert.equal(getNavigationSnapshot().pendingExit, null);
  resetNavigation();
  ok('Store push/pop + 50-cap GC + modal/dirty/exit flags + 5-state derivation');
}

// ---------- 8. SDL + wiring + hook/provider/dialog/layout/proxies (Gates 1-6) ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/navigation.graphql/schema.graphql', 'utf8');
  for (const t of ['NavigationStackItem', 'NavigationStatePayload', 'getNavigationSession', 'syncNavigationSession', 'clearNavigationSession']) {
    assert.ok(sdl.includes(t), `SDL missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/navigation/navigation.module.ts', 'utf8');
  assert.ok(mod.includes('NavigationService') && mod.includes('NavigationController') && mod.includes('NavigationResolver'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('NavigationModule'));
  const hook = readFileSync('apps/frontend/hooks/use-liff-navigation.ts', 'utf8');
  for (const st of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) assert.ok(hook.includes(st), `hook missing ${st}`);
  for (const marker of ['popstate', 'closeModal', 'requestExit', 'closeWindow', 'safeNavigate', 'confirmExit', 'sanitizeSensitiveState', 'randomUUID', '00000000-0000-4000-8000']) {
    assert.ok(hook.includes(marker), `hook missing ${marker}`);
  }
  assert.ok(!hook.includes("from 'zustand'") && !hook.includes('from "zustand"'), 'zero new deps: no zustand import');
  const provider = readFileSync('apps/frontend/components/navigation/liff-router-provider.tsx', 'utf8');
  for (const marker of ['--nav-bg', '--nav-text', '--brand-primary', 'ExitConfirmDialog', 'pendingExit']) {
    assert.ok(provider.includes(marker), `provider missing ${marker}`);
  }
  const dialog = readFileSync('apps/frontend/components/navigation/ExitConfirmDialog.tsx', 'utf8');
  assert.ok(dialog.includes('alertdialog') && dialog.includes('อยู่ต่อ'));
  assert.ok(!dialog.includes("from 'lucide") && !dialog.includes('from "lucide'), 'zero new deps: no lucide import');
  const layout = readFileSync('apps/frontend/app/(liff)/layout.tsx', 'utf8');
  assert.ok(layout.includes('LiffRouterProvider'));
  const syncProxy = readFileSync('apps/frontend/app/api/v1/navigation/sync/route.ts', 'utf8');
  assert.ok(syncProxy.includes('/api/v1/navigation/sync'));
  const restoreProxy = readFileSync('apps/frontend/app/api/v1/navigation/restore/route.ts', 'utf8');
  assert.ok(restoreProxy.includes('/api/v1/navigation/restore'));
  const client = readFileSync('apps/frontend/lib/navigation/navigation-client.ts', 'utf8');
  assert.ok(client.includes('sanitizeSensitiveState') && client.includes('signRouteState'));
  ok('SDL/code-first parity; module wired; hook 5-state + priorities; provider/dialog/layout/proxies');
}

console.log(`\nPhase 027 contracts: ${passed} checks passed`);
}

void main();
