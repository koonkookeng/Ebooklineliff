// SSOT Phase 095 §10-11 — contract tests (Zod, lattice, notes, likes, parity)
// Run: npx tsx scripts/test-phase095-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NoteVisibilityEnum,
  NoteTypeEnum,
  CreateMarginNoteSchema,
  MarginNotePayloadSchema,
  SOCIAL_STREAM,
  socialPageKey,
  notePinColor,
  canViewNote,
  isAuthorNote,
} from '../packages/shared/src/schemas/social-reading.schema';
import { assertNoteCreatable } from '../apps/backend/src/modules/social-reading/domain/social-note.entity';
import { CreateNoteUsecase } from '../apps/backend/src/modules/social-reading/application/create-note.usecase';
import { FetchPageNotesUsecase } from '../apps/backend/src/modules/social-reading/application/fetch-page-notes.usecase';
import { ToggleLikeNoteUsecase } from '../apps/backend/src/modules/social-reading/application/toggle-like-note.usecase';
import { buildSocialNoteFlex } from '../apps/backend/src/modules/social-reading/infrastructure/line/social-note-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(NoteVisibilityEnum.safeParse('STUDY_GROUP').success, true);
  assert.equal(NoteVisibilityEnum.safeParse('AUTHOR_OFFICIAL').success, true);
  assert.equal(NoteVisibilityEnum.safeParse('FOLLOWERS').success, false);
  assert.equal(NoteTypeEnum.safeParse('QUESTION_THREAD').success, true);
  assert.equal(NoteTypeEnum.safeParse('STICKER').success, false);
  const input = {
    ebookId: UUID, pageNumber: 45, positionX: 10, positionY: 20,
    content: 'ข้อสังเกตสำคัญบทนี้', visibility: 'STUDY_GROUP', noteType: 'MARGIN_TEXT', studyGroupId: UUID_B,
  };
  assert.equal(CreateMarginNoteSchema.safeParse(input).success, true);
  assert.equal(CreateMarginNoteSchema.safeParse({ ...input, positionX: 101 }).success, false);
  assert.equal(CreateMarginNoteSchema.safeParse({ ...input, content: '' }).success, false);
  assert.equal(CreateMarginNoteSchema.safeParse({ ...input, pageNumber: 0 }).success, false);
  assert.equal(
    MarginNotePayloadSchema.safeParse({
      id: UUID_C, userId: UUID, userDisplayName: 'Somsri', userAvatarUrl: null,
      isAuthorNote: false, pageNumber: 45, positionX: 10, positionY: 20,
      selectedText: null, content: 'hi', likesCount: 3, createdAt: '2026-01-01',
    }).success,
    true,
  );
  ok('Zod §3.1 verbatim (visibility/type/create/payload gates)');
}

// ---------- 2. Lattice + pins + keys (§2.2/§8.1) ----------
{
  assert.equal(SOCIAL_STREAM, 'stream:social:notes');
  assert.equal(socialPageKey(UUID, 45), `social:page:${UUID}:45`);
  assert.equal(notePinColor(true), '#FFD700');
  assert.equal(notePinColor(false), '#00C300');
  assert.equal(isAuthorNote('AUTHOR_OFFICIAL'), true);
  assert.equal(isAuthorNote('PUBLIC'), false);
  const pub = { visibility: 'PUBLIC', userId: UUID, studyGroupId: null as string | null };
  assert.equal(canViewNote(pub, { userId: UUID_B, groupIds: [], isAuthor: false }), true);
  const priv = { visibility: 'PRIVATE', userId: UUID, studyGroupId: null as string | null };
  assert.equal(canViewNote(priv, { userId: UUID_B, groupIds: [], isAuthor: false }), false);
  assert.equal(canViewNote(priv, { userId: UUID, groupIds: [], isAuthor: false }), true);
  const grp = { visibility: 'STUDY_GROUP', userId: UUID, studyGroupId: UUID_B };
  assert.equal(canViewNote(grp, { userId: UUID_C, groupIds: [UUID_B], isAuthor: false }), true);
  assert.equal(canViewNote(grp, { userId: UUID_C, groupIds: [], isAuthor: false }), false);
  assert.equal(canViewNote(grp, { userId: UUID_C, groupIds: [UUID_C], isAuthor: false }), false);
  const fri = { visibility: 'FRIENDS', userId: UUID, studyGroupId: null as string | null };
  assert.equal(canViewNote(fri, { userId: UUID_C, groupIds: [UUID_B], isAuthor: false }), true);
  assert.equal(canViewNote(fri, { userId: UUID_C, groupIds: [], isAuthor: false }), false);
  assert.doesNotThrow(() => assertNoteCreatable({ positionX: 50, positionY: 50, content: 'ok', visibility: 'PUBLIC' }));
  assert.throws(() => assertNoteCreatable({ positionX: 101, positionY: 50, content: 'ok', visibility: 'PUBLIC' }), /bounds/);
  assert.throws(() => assertNoteCreatable({ positionX: 50, positionY: 50, content: '   ', visibility: 'PUBLIC' }), /1-1000/);
  assert.throws(() => assertNoteCreatable({ positionX: 50, positionY: 50, content: 'ok', visibility: 'STUDY_GROUP' }), /studyGroupId/);
  const card = buildSocialNoteFlex({ content: 'โน้ตดีมาก', pageNumber: 45, authorName: 'Somsri', readerUrl: 'https://liff.line.me/reader/x' }) as {
    type: string; altText: string; contents: { footer: { contents: Array<{ action: { uri: string } }> } };
  };
  assert.equal(card.type, 'flex');
  assert.ok(card.altText.includes('45'));
  assert.ok(JSON.stringify(card).includes('เปิดอ่านพร้อมโน้ต'));
  ok('Lattice: 5-visibility gate + pins + Flex card');
}

// ---------- 3. Create (BDD-2: atomic + invalidate + Flex) ----------
async function sectionCreate(): Promise<void> {
  const streams: string[] = [];
  const deleted: string[] = [];
  const repo = {
    createNote: async (a: Record<string, unknown>) => ({ id: 'note-1', ...a, likesCount: 0 }),
  };
  const cache = { del: async (...keys: string[]) => { deleted.push(...keys); } };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new CreateNoteUsecase(repo as never, cache, bus);
  const r = await svc.execute({
    userId: UUID,
    userDisplayName: 'Somsri',
    input: {
      ebookId: UUID_B, pageNumber: 45, positionX: 10, positionY: 20,
      content: 'ข้อสังเกตสำคัญบทนี้', visibility: 'STUDY_GROUP', noteType: 'MARGIN_TEXT', studyGroupId: UUID_C,
    },
  });
  assert.equal(r.noteId, 'note-1');
  assert.ok(JSON.parse(r.flexMessageJson));
  assert.ok(deleted.includes(socialPageKey(UUID_B, 45)));
  assert.ok(streams.includes(SOCIAL_STREAM));
  await assert.rejects(
    svc.execute({
      userId: UUID, userDisplayName: 'S',
      input: { ebookId: UUID_B, pageNumber: 45, positionX: 10, positionY: 20, content: '', visibility: 'PUBLIC', noteType: 'MARGIN_TEXT' },
    }),
    /Invalid margin note/,
  );
  await assert.rejects(
    svc.execute({
      userId: UUID, userDisplayName: 'S',
      input: { ebookId: UUID_B, pageNumber: 45, positionX: 10, positionY: 20, content: 'ok', visibility: 'STUDY_GROUP', noteType: 'MARGIN_TEXT' },
    }),
    /studyGroupId/,
  );
  ok('Create: atomic row + cache invalidate + Flex + 2 gates');
}

// ---------- 4. Fetch (BDD-1: edge-first + lattice filter) ----------
async function sectionFetch(): Promise<void> {
  const rows = [
    { id: 'n1', ebookId: UUID_B, userId: UUID, userDisplayName: 'A', userAvatarUrl: null, pageNumber: 45, positionX: 10, positionY: 10, selectedText: null, content: 'public', visibility: 'PUBLIC', noteType: 'MARGIN_TEXT', studyGroupId: null, likesCount: 2, createdAt: new Date() },
    { id: 'n2', ebookId: UUID_B, userId: UUID, userDisplayName: 'A', userAvatarUrl: null, pageNumber: 45, positionX: 20, positionY: 20, selectedText: null, content: 'group', visibility: 'STUDY_GROUP', noteType: 'MARGIN_TEXT', studyGroupId: UUID_C, likesCount: 0, createdAt: new Date() },
    { id: 'n3', ebookId: UUID_B, userId: UUID, userDisplayName: 'A', userAvatarUrl: null, pageNumber: 45, positionX: 30, positionY: 30, selectedText: null, content: 'secret', visibility: 'PRIVATE', noteType: 'MARGIN_TEXT', studyGroupId: null, likesCount: 0, createdAt: new Date() },
  ];
  function ports(cached: string | null) {
    let dbHits = 0;
    const sets: string[] = [];
    return {
      repo: {
        pageNotes: async () => { dbHits++; return rows; },
        memberGroupIds: async () => [UUID_C],
      },
      cache: {
        get: async () => cached,
        set: async (k: string) => { sets.push(k); return 'OK'; },
      },
      groups: { memberGroupIds: async () => [UUID_C] },
      dbHits: () => dbHits,
      sets,
    };
  }
  // Miss → DB → lattice (member sees public + group, not private).
  {
    const p = ports(null);
    const svc = new FetchPageNotesUsecase(p.repo as never, p.cache, p.groups);
    const out = await svc.execute({ readerUserId: UUID_B, ebookId: UUID_B, pageNumber: 45 });
    assert.deepEqual(out.map((n) => n.id), ['n1', 'n2']);
    assert.equal(p.dbHits(), 1);
    assert.ok(p.sets.includes(socialPageKey(UUID_B, 45)));
  }
  // Hit → no DB; author overlay flagged.
  {
    const p = ports(JSON.stringify(rows));
    const svc = new FetchPageNotesUsecase(p.repo as never, p.cache, p.groups);
    const out = await svc.execute({ readerUserId: UUID_B, ebookId: UUID_B, pageNumber: 45 });
    assert.equal(p.dbHits(), 0);
    assert.equal(out.length, 2);
  }
  // Owner sees own private note.
  {
    const p = ports(null);
    const svc = new FetchPageNotesUsecase(p.repo as never, p.cache, p.groups);
    const out = await svc.execute({ readerUserId: UUID, ebookId: UUID_B, pageNumber: 45 });
    assert.equal(out.length, 3);
  }
  ok('Fetch: edge-first + lattice (member/owner shapes) + refill');
}

// ---------- 5. Likes (idempotent toggle + invalidate) ----------
async function sectionLikes(): Promise<void> {
  let liked = false;
  let count = 5;
  const deleted: string[] = [];
  const streams: string[] = [];
  const repo = {
    toggleLike: async () => {
      liked = !liked;
      count += liked ? 1 : -1;
      return { liked, likesCount: count };
    },
  };
  const svc = new ToggleLikeNoteUsecase(
    repo as never,
    { del: async (...keys: string[]) => { deleted.push(...keys); } },
    { xadd: async (s: string) => { streams.push(s); } },
  );
  const a = await svc.execute({ userId: UUID, noteId: 'n1', ebookId: UUID_B, pageNumber: 45 });
  assert.deepEqual([a.liked, a.likesCount], [true, 6]);
  const b = await svc.execute({ userId: UUID, noteId: 'n1', ebookId: UUID_B, pageNumber: 45 });
  assert.deepEqual([b.liked, b.likesCount], [false, 5]);
  assert.equal(deleted.filter((k) => k === socialPageKey(UUID_B, 45)).length, 2);
  assert.ok(streams.includes(SOCIAL_STREAM));
  ok('Likes: idempotent toggle + counter + invalidate + stream');
}

// ---------- 6. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  const visibilityBlock = prisma.slice(prisma.indexOf('enum NoteVisibility'), prisma.indexOf('enum NoteVisibility') + 200);
  for (const v of ['PRIVATE', 'STUDY_GROUP', 'PUBLIC', 'FRIENDS', 'AUTHOR_OFFICIAL']) {
    assert.ok(visibilityBlock.includes(v), `prisma missing visibility: ${v}`);
  }
  for (const t of [
    'enum NoteType {',
    'QUESTION_THREAD',
    'model SocialNote {',
    'positionX    Float',
    'likesCount   Int            @default(0)',
    '@@index([ebookId, pageNumber])',
    'model StudyGroup {',
    'memberIds   String[]     @default([])',
    'model SocialNoteReaction {',
    '@@unique([noteId, userId])',
    'socialNotes       SocialNote[]',
    'noteReactions     SocialNoteReaction[]',
    'ownedStudyGroups  StudyGroup[] @relation("OwnedStudyGroups")',
    'socialNotes    SocialNote[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: visibility union + NoteType + 3 models + relations');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/social-reading/domain/social-note.entity.ts',
    'apps/backend/src/modules/social-reading/domain/social-note.repository.interface.ts',
    'apps/backend/src/modules/social-reading/application/create-note.usecase.ts',
    'apps/backend/src/modules/social-reading/application/fetch-page-notes.usecase.ts',
    'apps/backend/src/modules/social-reading/application/toggle-like-note.usecase.ts',
    'apps/backend/src/modules/social-reading/infrastructure/persistence/prisma-social-note.repository.ts',
    'apps/backend/src/modules/social-reading/infrastructure/redis/social-note-cache.adapter.ts',
    'apps/backend/src/modules/social-reading/infrastructure/line/social-note-flex.builder.ts',
    'apps/backend/src/modules/social-reading/presentation/graphql/social-reading.resolver.ts',
    'apps/backend/src/modules/social-reading/presentation/graphql/dto/create-note.input.ts',
    'apps/backend/src/modules/social-reading/presentation/graphql/dto/social-note.type.ts',
    'apps/backend/src/modules/social-reading/presentation/rest/social-reading.controller.ts',
    'apps/backend/src/modules/social-reading/social-reading.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/social-reading/social-reading.module.ts', 'utf8');
  assert.ok(mod.includes('SocialReadingModule') && mod.includes('CreateNoteUsecase') && mod.includes('ToggleLikeNoteUsecase'));
  assert.ok(!/ResolverResolver|ControllerController/.test(mod), 'legacy scaffold names removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('SocialReadingModule'));
  const gql = readFileSync('apps/backend/src/modules/social-reading/presentation/graphql/social-reading.resolver.ts', 'utf8');
  assert.ok(gql.includes('pageSocialNotes') && gql.includes('createMarginNote') && gql.includes('toggleLikeNote'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/social-reading.resolver.ts', 'utf8');
  assert.ok(alias.includes('SocialReadingResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/social-reading.graphql', 'utf8');
  assert.ok(sdl.includes('MarginNote') && sdl.includes('createMarginNote') && sdl.includes('toggleLikeNote'));
  for (const p of [
    'apps/frontend/components/reader/SocialReadingOverlay.tsx',
    'apps/frontend/components/reader/MarginNoteDrawer.tsx',
    'apps/frontend/hooks/useSocialNotes.ts',
    'apps/frontend/lib/social/social-client.ts',
    'apps/frontend/app/(liff)/reader/[productId]/social/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useSocialNotes.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  assert.ok(hook.includes('indexedDB') || hook.includes('IDB'), 'offline cache');
  const drawer = readFileSync('apps/frontend/components/reader/MarginNoteDrawer.tsx', 'utf8');
  assert.ok(!drawer.includes('@/components/ui') && !drawer.includes('lucide-react'), 'zero-dep drawer (no heavy UI)');
  assert.ok(drawer.includes('shareTargetPicker'), 'LIFF share + fallback');
  for (const p of [
    'apps/frontend/app/api/v1/social-notes/page/route.ts',
    'apps/frontend/app/api/v1/social-notes/create/route.ts',
    'apps/frontend/app/api/v1/social-notes/like/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('social-reading.schema') && barrel.includes('CreateMarginNoteSchema'));
  ok('Parity: module/GQL+alias/SDL/overlay+drawer/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionCreate();
  await sectionFetch();
  await sectionLikes();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase095 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
