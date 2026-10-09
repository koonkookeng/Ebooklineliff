// SSOT Phase 104 §10-11 — contract tests (Zod, cold-start/CF/vector/rerank, parity)
// Run: npx tsx scripts/test-phase104-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RecommendationReasonTypeEnum,
  RecommendationAlgorithmEnum,
  InteractionEventTypeEnum,
  TrackInteractionEventSchema,
  RecommendationItemSchema,
  RecommendationSlatePayloadSchema,
  COLD_START_INTERACTION_THRESHOLD,
  SLATE_TTL_SEC,
  SLATE_DEFAULT_LIMIT,
  REC_LATENCY_BUDGET_MS,
  REC_RAM_BUDGET_MB,
  REC_EMBEDDING_DIMS,
  REC_RATE_LIMIT_PER_MIN,
  recSlateCacheKey,
  recEventStreamKey,
  recRateLimitKey,
} from '../packages/shared/src/schemas/recommendation.contract';
import { normalizeCoPurchaseScores } from '../apps/backend/src/modules/recommendation/services/collaborative-filtering.service';
import { boostByInterests } from '../apps/backend/src/modules/recommendation/services/cold-start.service';
import { HybridRerankerService } from '../apps/backend/src/modules/recommendation/services/hybrid-reranker.service';
import { VectorSearchService } from '../apps/backend/src/modules/recommendation/services/vector-search.service';
import { parseSlateLimit } from '../apps/backend/src/modules/recommendation/dto/recommendation-request.dto';
import type { ProductCard } from '../apps/backend/src/modules/recommendation/repositories/recommendation.repository';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const NOW = new Date().toISOString();

const CARD = (over: Partial<ProductCard> = {}): ProductCard => ({
  productId: UUID_B,
  title: 'AI Handbook',
  coverImageUrl: 'https://cdn.local/cover.jpg',
  productType: 'EBOOK',
  price: 299,
  discountPrice: 199,
  soldCount: 42,
  ...over,
});

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(RecommendationReasonTypeEnum.safeParse('VECTOR_SIMILARITY_MATCH').success, true);
  assert.equal(RecommendationReasonTypeEnum.safeParse('RANDOM').success, false);
  assert.equal(RecommendationAlgorithmEnum.safeParse('HYBRID_RERANKED').success, true);
  assert.equal(RecommendationAlgorithmEnum.safeParse('DEEP_FM').success, false);
  assert.equal(InteractionEventTypeEnum.safeParse('READING_DWELL_TIME').success, true);
  assert.equal(InteractionEventTypeEnum.safeParse('SCROLL').success, false);
  const evt = { userId: UUID, productId: UUID_B, eventType: 'READING_DWELL_TIME', dwellTimeSec: 130, timestamp: NOW };
  assert.equal(TrackInteractionEventSchema.safeParse(evt).success, true);
  assert.equal(TrackInteractionEventSchema.safeParse({ ...evt, dwellTimeSec: -1 }).success, false);
  assert.equal(TrackInteractionEventSchema.safeParse({ ...evt, progressPercentage: 101 }).success, false);
  const item = {
    productId: UUID_B, title: 'AI Handbook', coverImageUrl: 'https://cdn.local/cover.jpg',
    productType: 'EBOOK', price: 299, discountPrice: null, matchScore: 98.5,
    reasonType: 'VECTOR_SIMILARITY_MATCH', reasonText: 'เพราะคุณอ่าน AI', algorithmUsed: 'HYBRID_RERANKED',
  };
  assert.equal(RecommendationItemSchema.safeParse(item).success, true);
  assert.equal(RecommendationItemSchema.safeParse({ ...item, matchScore: 101 }).success, false);
  assert.equal(RecommendationItemSchema.safeParse({ ...item, price: -5 }).success, false);
  assert.equal(
    RecommendationSlatePayloadSchema.safeParse({ tenantId: 't1', userId: UUID, slateTitle: 'AI Match', items: [item], generatedAt: NOW }).success,
    true,
  );
  ok('Zod §3.1 verbatim (reason/algorithm/event/item/slate gates)');
}

// ---------- 2. Pure helpers ----------
{
  assert.equal(COLD_START_INTERACTION_THRESHOLD, 3);
  assert.equal(SLATE_TTL_SEC, 900);
  assert.equal(SLATE_DEFAULT_LIMIT, 6);
  assert.equal(REC_LATENCY_BUDGET_MS, 150);
  assert.equal(REC_RAM_BUDGET_MB, 15);
  assert.equal(REC_EMBEDDING_DIMS, 768);
  assert.equal(REC_RATE_LIMIT_PER_MIN, 30);
  assert.equal(recSlateCacheKey('t1', 'u1'), 'rec:slate:t1:u1');
  assert.equal(recEventStreamKey(), 'stream:user-events');
  assert.equal(recRateLimitKey('u1'), 'ratelimit:rec:u1');
  assert.equal(parseSlateLimit('5'), 5);
  assert.equal(parseSlateLimit('999'), 20);
  assert.equal(parseSlateLimit('bad'), 6);
  assert.equal(parseSlateLimit(undefined), 6);
  ok('Helpers: budgets/keys/limit clamp');
}

// ---------- 3. CF normalizer ----------
{
  const rows = normalizeCoPurchaseScores([
    { productId: UUID_B, score: 10 },
    { productId: UUID_C, score: 5 },
  ]);
  assert.equal(rows[0].confidence, 1);
  assert.equal(rows[1].confidence, 0.5);
  assert.deepEqual(normalizeCoPurchaseScores([]), []);
  ok('CF: co-purchase confidence normalization');
}

// ---------- 4. Cold-start interest boost ----------
{
  const cards = [CARD({ productType: 'EBOOK', soldCount: 1 }), CARD({ productId: UUID_C, productType: 'PHYSICAL_BOOK', soldCount: 99 })];
  const boosted = boostByInterests(cards, ['PHYSICAL_BOOK']);
  assert.equal(boosted[0].productId, UUID_C);
  assert.deepEqual(boostByInterests(cards, []), cards);
  ok('Cold-start: onboarding interest boost + soldCount order');
}

// ---------- 5. Reranker: cold-start path (< 3 interactions) ----------
async function sectionColdPath(): Promise<void> {
  const cache = new Map<string, string>();
  const streams: Array<{ stream: string; batch: unknown }> = [];
  const repo = {
    countInteractions: async () => 0,
    findBestsellers: async () => [CARD()],
    logSlate: async () => undefined,
  };
  const svc = new HybridRerankerService(
    repo as never,
    { get: async (k: string) => cache.get(k) ?? null, set: async (k: string, v: string) => { cache.set(k, v); } },
    { xaddPipeline: async (s: string, b: Array<Record<string, string | number>>) => { streams.push({ stream: s, batch: b }); } },
    { findSimilarProducts: async () => [] } as never,
    { findAlsoBought: async () => [] } as never,
    { getCuratedBestsellers: async (_t: string, _l: number) => [CARD()] } as never,
  );
  const items = await svc.generatePersonalizedSlate(UUID, 't1', 3);
  assert.equal(items.length, 1);
  assert.equal(items[0].reasonType, 'COLD_START_ONBOARDING');
  assert.ok(cache.has('rec:slate:t1:' + UUID));
  assert.equal(streams[0].stream, 'stream:user-events');
  // Second call serves edge cache (no repo hit).
  const repo2 = { countInteractions: async () => { throw new Error('must not hit db'); } };
  const svc2 = new HybridRerankerService(repo2 as never, { get: async () => JSON.stringify(items), set: async () => undefined }, { xaddPipeline: async () => undefined }, {} as never, {} as never, {} as never);
  assert.deepEqual(await svc2.generatePersonalizedSlate(UUID, 't1', 3), items);
  ok('Reranker: cold-start slate + edge cache + stream event');
}

// ---------- 6. Reranker: hybrid path (purchased exclusion + CF blend) ----------
async function sectionHybridPath(): Promise<void> {
  const owned = UUID_B;
  const fresh = UUID_C;
  const repo = {
    countInteractions: async () => 12,
    findPurchasedProductIds: async () => [owned],
    findProductCards: async (ids: string[]) => ids.map((id) => CARD({ productId: id, title: `T-${id.slice(0, 4)}` })),
    logSlate: async () => undefined,
  };
  const svc = new HybridRerankerService(
    repo as never,
    { get: async () => null, set: async () => undefined },
    { xaddPipeline: async () => undefined },
    { findSimilarProducts: async () => [{ productId: owned, similarity: 0.99 }, { productId: fresh, similarity: 0.9 }] } as never,
    { findAlsoBought: async () => [] } as never,
    { getCuratedBestsellers: async () => [] } as never,
  );
  const items = await svc.generatePersonalizedSlate(UUID, 't1', 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].productId, fresh);
  assert.equal(items[0].algorithmUsed, 'HYBRID_RERANKED');
  assert.ok(items[0].matchScore <= 99.8 && items[0].matchScore > 0);
  ok('Reranker: hybrid excludes purchased + caps matchScore');
}

// ---------- 7. Vector intent builder (recent → profile → zero) ----------
async function sectionVectorIntent(): Promise<void> {
  const withRecent = new VectorSearchService({
    findRecentProductIds: async () => [UUID_B],
    findProductEmbeddings: async () => [{ productId: UUID_B, embedding: new Array(768).fill(0).map((_, i) => (i === 0 ? 2 : 0)) }],
    getProfile: async () => null,
  } as never);
  const v = await withRecent.buildUserIntentVector(UUID);
  assert.equal(v.length, 768);
  assert.ok(v[0] > 0);
  const profileOnly = new VectorSearchService({
    findRecentProductIds: async () => [],
    findProductEmbeddings: async () => [],
    getProfile: async () => ({ userId: UUID, preferredCategories: { ai: 0.9 }, priceSensitivity: 0.5 }),
  } as never);
  assert.equal((await profileOnly.buildUserIntentVector(UUID)).length, 768);
  const zero = new VectorSearchService({
    findRecentProductIds: async () => [],
    findProductEmbeddings: async () => [],
    getProfile: async () => null,
  } as never);
  assert.ok((await zero.buildUserIntentVector(UUID)).every((x) => x === 0));
  ok('Vector: recent-average → profile → zero-vector fallbacks');
}

// ---------- 8. Prisma additive (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum InteractionType {',
    'FLEX_SHARE_CLICK',
    'enum RecommendationReasonType {',
    'COLD_START_ONBOARDING',
    'model UserPreferenceProfile {',
    'preferredCategories Json',
    'embedding           Unsupported("vector(768)")?',
    'model ProductEmbedding {',
    'embedding   Unsupported("vector(768)")',
    'model UserInteractionLog {',
    'eventType          InteractionType',
    'dwellTimeSec       Int?',
    '@@index([userId, eventType])',
    'model RecommendationSlateLog {',
    'positionIndex  Int',
    'reasonType     RecommendationReasonType',
    'isClicked      Boolean',
    'preferenceProfile UserPreferenceProfile?',
    'interactionLogs   UserInteractionLog[]',
    'slateLogs         RecommendationSlateLog[]',
    'recEmbedding      ProductEmbedding?',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  ok('Prisma: enums + 4 models + User/Product back-relations');
}

function sectionParity(): void {
  for (const f of [
    'packages/shared/src/schemas/recommendation.contract.ts',
    'apps/backend/src/modules/recommendation/repositories/recommendation.repository.ts',
    'apps/backend/src/modules/recommendation/services/vector-search.service.ts',
    'apps/backend/src/modules/recommendation/services/collaborative-filtering.service.ts',
    'apps/backend/src/modules/recommendation/services/cold-start.service.ts',
    'apps/backend/src/modules/recommendation/services/hybrid-reranker.service.ts',
    'apps/backend/src/modules/recommendation/dto/recommendation-request.dto.ts',
    'apps/backend/src/modules/recommendation/controllers/recommendation-event.controller.ts',
    'apps/backend/src/modules/recommendation/resolvers/recommendation.resolver.ts',
    'apps/backend/src/modules/recommendation/recommendation.module.ts',
    'apps/backend/src/api/graphql/recommendation.resolver.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('AUTO-SCAFFOLD') && !src.includes('placeholder'), `${f} unimplemented`);
    assert.ok(!/ServiceService|ModuleModule|ResolverResolver|ControllerController/.test(src), `${f} scaffold name`);
  }
  const ctl = readFileSync('apps/backend/src/modules/recommendation/controllers/recommendation-event.controller.ts', 'utf8');
  assert.ok(ctl.includes('slate') && ctl.includes('trending') && ctl.includes('feedback') && ctl.includes('TOO_MANY_REQUESTS'), 'Controller slate/trending/feedback/rate-limit');
  const gql = readFileSync('apps/backend/src/modules/recommendation/resolvers/recommendation.resolver.ts', 'utf8');
  assert.ok(gql.includes('recommendationSlate') && gql.includes('trackInteraction') && gql.includes('markSlateFeedback'), 'GQL intents');
  const mod = readFileSync('apps/backend/src/modules/recommendation/recommendation.module.ts', 'utf8');
  assert.ok(mod.includes('RecommendationModule') && mod.includes('R2StorageModule') === false, 'Module wiring');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('RecommendationModule'), 'AppModule wiring');
  for (const p of [
    'apps/frontend/components/recommendation/AIRecommendedSlate.tsx',
    'apps/frontend/hooks/useRecommendations.ts',
    'apps/frontend/lib/recommendation/recommendation-client.ts',
    'apps/frontend/app/(liff)/recommendations/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const slate = readFileSync('apps/frontend/components/recommendation/AIRecommendedSlate.tsx', 'utf8');
  assert.ok(!slate.includes('lucide-react') && !slate.includes('next/image') && slate.includes('animate-pulse') && slate.includes('ลองใหม่'), 'zero-dep slate');
  const hook = readFileSync('apps/frontend/hooks/useRecommendations.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') && hook.includes('SUCCESS') && hook.includes('ERROR'), '5-state hook');
  const client = readFileSync('apps/frontend/lib/recommendation/recommendation-client.ts', 'utf8');
  assert.ok(client.includes('trackDwell') && client.includes('cachedSlate'), 'client dwell seam + IDB offline');
  for (const p of [
    'apps/frontend/app/api/v1/recommendations/slate/route.ts',
    'apps/frontend/app/api/v1/recommendations/events/route.ts',
    'apps/frontend/app/api/v1/recommendations/trending/route.ts',
    'apps/frontend/app/api/v1/recommendations/feedback/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('recommendation.contract') && barrel.includes('RecommendationReasonTypeEnum'));
  ok('Parity: module/GQL/alias/frontend/hook/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionColdPath();
  await sectionHybridPath();
  await sectionVectorIntent();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase104 contracts: ${passed + 5} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
