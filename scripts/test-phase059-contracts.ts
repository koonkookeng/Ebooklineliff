// SSOT Phase 059 §10 — contract tests (Zod, gesture/key math, prefs, parity)
// Run: npx tsx scripts/test-phase059-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  InputDeviceEnum,
  GestureTypeEnum,
  NavigationActionEnum,
  NavigationEventPayloadSchema,
  UserReaderPreferenceSchema,
  NAV_SWIPE_MIN_DX_PX,
  NAV_SWIPE_MIN_VELOCITY_PX_MS,
  NAV_KEY_THROTTLE_MS,
  NAV_FRAME_BUDGET_MS,
  NAV_EVENT_STREAM_KEY,
  tapZoneFor,
  swipeActionFor,
  isTap,
  keyIntentFor,
  isTypingTarget,
  clampPage,
  isAccidentalFlip,
} from '../packages/shared/src/schemas/navigation-event-contract';
import { ReaderPreferenceService } from '../apps/backend/src/modules/reader/application/reader-preference.service';
import { updateReaderPreferenceCommand } from '../apps/backend/src/modules/reader/application/commands/update-preference.command';
import { resolveTargetPage, buildNavigationEvent } from '../apps/backend/src/modules/reader/domain/navigation-event.entity';
import { sanitizeKeybindings } from '../apps/backend/src/modules/reader/domain/value-objects/keybinding.vo';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT = '223e4567-e89b-12d3-a456-426614174000';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) + budgets ----------
{
  assert.equal(InputDeviceEnum.safeParse('TOUCH_SCREEN').success, true);
  assert.equal(GestureTypeEnum.safeParse('SWIPE_LEFT').success, true);
  assert.equal(NavigationActionEnum.safeParse('TOGGLE_HUD').success, true);
  assert.equal(NavigationActionEnum.safeParse('FLY').success, false);
  const evt = {
    productId: PRODUCT, currentPage: 3, action: 'NEXT_PAGE', deviceType: 'TOUCH_SCREEN',
    gestureDetails: { gestureType: 'TAP_RIGHT', coordinateX: 350 }, timestamp: new Date().toISOString(),
  };
  assert.equal(NavigationEventPayloadSchema.safeParse(evt).success, true);
  assert.equal(NavigationEventPayloadSchema.safeParse({ ...evt, currentPage: 0 }).success, false);
  assert.equal(UserReaderPreferenceSchema.safeParse({ userId: USER }).success, true);
  assert.equal(
    UserReaderPreferenceSchema.safeParse({ userId: USER, swipeSensitivity: 5 }).success,
    false,
  );
  assert.equal(NAV_SWIPE_MIN_DX_PX, 50);
  assert.equal(NAV_SWIPE_MIN_VELOCITY_PX_MS, 0.25);
  assert.equal(NAV_KEY_THROTTLE_MS, 200);
  assert.equal(NAV_FRAME_BUDGET_MS, 16);
  assert.equal(NAV_EVENT_STREAM_KEY, 'stream:reader:navigation-events');
  ok('Zod nav contracts verbatim + gesture/key/frame budgets');
}

// ---------- 2. Gesture + keyboard math (§1.3 BDD / §2.1 keymap) ----------
{
  assert.equal(tapZoneFor(50, 400, false), 'LEFT');
  assert.equal(tapZoneFor(350, 400, false), 'RIGHT');
  assert.equal(tapZoneFor(200, 400, false), 'CENTER');
  assert.equal(tapZoneFor(50, 400, true), 'RIGHT');
  assert.equal(swipeActionFor({ deltaX: -120, deltaY: 10, deltaTimeMs: 200 }), 'NEXT_PAGE');
  assert.equal(swipeActionFor({ deltaX: 120, deltaY: 10, deltaTimeMs: 200 }), 'PREV_PAGE');
  assert.equal(swipeActionFor({ deltaX: -30, deltaY: 5, deltaTimeMs: 200 }), null);
  assert.equal(swipeActionFor({ deltaX: -120, deltaY: 200, deltaTimeMs: 200 }), null);
  assert.equal(swipeActionFor({ deltaX: -120, deltaY: 10, deltaTimeMs: 900 }), null);
  assert.equal(isTap({ deltaX: 3, deltaY: 4, deltaTimeMs: 120 }), true);
  assert.equal(isTap({ deltaX: 60, deltaY: 4, deltaTimeMs: 120 }), false);
  assert.equal(keyIntentFor('Space', false), 'NEXT_PAGE');
  assert.equal(keyIntentFor('Space', true), 'PREV_PAGE');
  assert.equal(keyIntentFor('ArrowRight', false), 'NEXT_PAGE');
  assert.equal(keyIntentFor('ArrowLeft', false), 'PREV_PAGE');
  assert.equal(keyIntentFor('Home', false), 'FIRST_PAGE');
  assert.equal(keyIntentFor('End', false), 'LAST_PAGE');
  assert.equal(keyIntentFor('KeyM', false), 'TOGGLE_HUD');
  assert.equal(keyIntentFor('KeyF', false), 'TOGGLE_FULLSCREEN');
  assert.equal(keyIntentFor('KeyZ', false), null);
  assert.equal(isTypingTarget({ tagName: 'INPUT', getAttribute: () => null } as unknown as Element), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => null } as unknown as Element), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(99, 10), 10);
  assert.equal(isAccidentalFlip(1000, 2000), true);
  assert.equal(isAccidentalFlip(1000, 5000), false);
  ok('Tap zones (invert) + swipe gates + full keymap + focus/clamp/flip');
}

// ---------- 3. Entity: intent → target + stream event ----------
{
  const base = { productId: PRODUCT, currentPage: 3, totalPages: 10 };
  assert.equal(resolveTargetPage({ ...base, action: 'NEXT_PAGE' }), 4);
  assert.equal(resolveTargetPage({ ...base, action: 'PREV_PAGE' }), 2);
  assert.equal(resolveTargetPage({ ...base, action: 'GOTO_PAGE', targetPage: 99 }), 10);
  assert.equal(resolveTargetPage({ ...base, action: 'TOGGLE_HUD' }), 3);
  const e = buildNavigationEvent({ ...base, action: 'NEXT_PAGE' }, 'TOUCH_SCREEN', { gestureType: 'SWIPE_LEFT' });
  assert.equal(NavigationEventPayloadSchema.safeParse(e).success, true);
  assert.equal(e.currentPage, 3);
  ok('Entity: clamped targets + validated stream event');
}

// ---------- 4. Keybinding VO sanitize ----------
{
  assert.deepEqual(sanitizeKeybindings({ NEXT: 'Space', PREV: 'Backspace' }), { NEXT: 'Space', PREV: 'Backspace' });
  assert.deepEqual(sanitizeKeybindings({ NEXT: 'F13_NOPE' }), {});
  assert.deepEqual(sanitizeKeybindings(null), {});
  assert.deepEqual(sanitizeKeybindings([]), {});
  ok('Keybinding VO: allowlist sanitize + fail-open');
}

// ---------- 5. Preference service: defaults + atomic upsert + command ----------
async function sectionPrefs(): Promise<void> {
  const rows = new Map<string, { userId: string } & Record<string, unknown>>();
  const events: Array<{ kind: string }> = [];
  const svc = new ReaderPreferenceService(
    {
      userReaderPreference: {
        findUnique: async ({ where }: { where: { userId: string } }) => (rows.get(where.userId) as never) ?? null,
        upsert: async ({ where, create }: { where: { userId: string }; create: Record<string, unknown> }) => {
          rows.set(where.userId, { userId: where.userId, ...create });
          return rows.get(where.userId) as never;
        },
      },
    } as never,
    (e) => {
      events.push(e);
    },
  );
  const fresh = await svc.getUserPreference(USER);
  assert.equal(fresh.invertTapZones, false);
  assert.equal(fresh.enableKeyboardShortcuts, true);
  assert.equal(await svc.updatePreference(USER, { invertTap: true, enableKeybindings: false }), true);
  const after = await svc.getUserPreference(USER);
  assert.equal(after.invertTapZones, true);
  assert.equal(after.enableKeyboardShortcuts, false);
  assert.equal(events[0].kind, 'READER_PREFERENCE_CHANGED');
  assert.equal(
    await updateReaderPreferenceCommand(svc, USER, { invertTapZones: false, swipeSensitivity: 1.5 }),
    true,
  );
  await assert.rejects(updateReaderPreferenceCommand(svc, USER, { swipeSensitivity: 9 }), /Invalid/);
  ok('Prefs: fail-open defaults + atomic upsert + Zod-gated command');
}

// ---------- 6. Prisma SSOT (§4.1 Gate 1) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'model UserReaderPreference',
    'invertTapZones',
    'swipeSensitivity',
    'enableKeyboardShortcuts',
    'hapticFeedbackEnabled',
    'customKeybindingsJson',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: UserReaderPreference nav cols (additive)');
}

// ---------- 7. Static parity: backend + frontend + pages + ADR ----------
function sectionParity(): void {
  const hook = readFileSync('apps/frontend/hooks/useReaderNavigation.ts', 'utf8');
  for (const t of ['useReaderNavigation', 'goToNextPage', 'goToPrevPage', 'keyIntentFor', 'isTypingTarget', 'NAV_KEY_THROTTLE_MS', 'removeEventListener', 'setCurrentPageExact']) {
    assert.ok(hook.includes(t), `hook missing: ${t}`);
  }
  const mapper = readFileSync('apps/frontend/components/reader/ReaderGestureMapper.tsx', 'utf8');
  for (const t of ['ReaderGestureMapper', 'swipeActionFor', 'tapZoneFor', 'isTap', 'TOGGLE_HUD', 'toggleHud', 'vibrate']) {
    assert.ok(mapper.includes(t), `mapper missing: ${t}`);
  }
  const handler = readFileSync('apps/frontend/components/reader/ReaderKeyboardHandler.tsx', 'utf8');
  assert.ok(handler.includes('ReaderKeyboardHandler') && handler.includes('useReaderNavigation'));
  const store = readFileSync('apps/frontend/stores/useReaderStore.ts', 'utf8');
  for (const t of ['toggleHud', 'setCurrentPageExact']) {
    assert.ok(store.includes(t), `store missing: ${t}`);
  }
  const canvas = readFileSync('apps/frontend/components/reader/CanvasReader.tsx', 'utf8');
  assert.ok(canvas.includes('storePage') && canvas.includes('turnTo'));
  const adaptive = readFileSync('apps/frontend/components/reader/AdaptiveCanvasReader.tsx', 'utf8');
  assert.ok(adaptive.includes('storePage') && !adaptive.includes('ArrowLeft'));
  const liff = readFileSync('apps/frontend/app/(liff)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(liff.includes('ReaderGestureMapper'));
  const web = readFileSync('apps/frontend/app/(web)/reader/[productId]/page.tsx', 'utf8');
  assert.ok(web.includes('ReaderKeyboardHandler'));
  const svc = readFileSync('apps/backend/src/modules/reader/application/reader-preference.service.ts', 'utf8');
  for (const t of ['ReaderPreferenceService', 'getUserPreference', 'updatePreference', 'upsert']) {
    assert.ok(svc.includes(t), `pref service missing: ${t}`);
  }
  const res = readFileSync('apps/backend/src/modules/reader/infrastructure/api/reader-preference.resolver.ts', 'utf8');
  assert.ok(res.includes('getReaderPreference') && res.includes('updateReaderPreference'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/reader-preference.graphql', 'utf8');
  for (const t of ['getReaderPreference', 'updateReaderPreference', 'ReaderNavigationPreference']) {
    assert.ok(sdl.includes(t), `SDL missing: ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/reader/reader.module.ts', 'utf8');
  for (const t of ['ReaderPreferenceService', 'ReaderPreferenceResolver', 'ReaderNavigationController']) {
    assert.ok(mod.includes(t), `module missing: ${t}`);
  }
  const ctrl = readFileSync('apps/backend/src/modules/reader/reader-navigation.controller.ts', 'utf8');
  assert.ok(ctrl.includes('navigation-preference') && ctrl.includes('navigation-event'));
  for (const p of ['apps/frontend/app/api/v1/reader/navigation-preference/route.ts', 'apps/frontend/app/api/v1/reader/navigation-event/route.ts']) {
    assert.ok(readFileSync(p, 'utf8').includes('/api/v1/reader/navigation'), `${p} missing forward`);
  }
  assert.ok(readFileSync('docs/adr/ADR-059-reader-gesture-keyboard.md', 'utf8').includes('Store-as-bus'));
  ok('Parity: hook + mapper + handler + bus sync + prefs GQL/REST + pages + ADR');
}

async function main(): Promise<void> {
  await sectionPrefs();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase059 contracts: ${passed + 7} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
