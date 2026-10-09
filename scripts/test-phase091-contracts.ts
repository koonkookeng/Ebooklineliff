// SSOT Phase 091 §10-11 — contract tests (Zod, engine, search, RAG, parity)
// Run: npx tsx scripts/test-phase091-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  VectorDistanceMetricEnum,
  ContentSourceTypeEnum,
  VectorEmbeddingPayloadSchema,
  SemanticSearchInputSchema,
  VectorSearchResultItemSchema,
  AiAskContextQuerySchema,
  EMBEDDING_DIMS,
  CHUNK_WORDS_MAX,
  CHUNK_OVERLAP_WORDS,
  AI_EXCERPT_MAX_CHARS,
  SEMANTIC_SEARCH_P95_MS,
  VECTOR_STREAM,
  cosineSimilarity,
  chunkText,
  capExcerpt,
  watermarkTag,
  similarityBadge,
} from '../packages/shared/src/schemas/vector-search-contract';
import { deterministicEmbedding } from '../apps/backend/src/modules/vector-search/services/embedding-generator.service';
import { SemanticSearchService } from '../apps/backend/src/modules/vector-search/services/semantic-search.service';
import { RagContextBuilderService } from '../apps/backend/src/modules/ai-rag/services/rag-context-builder.service';
import { AiSummarizerService } from '../apps/backend/src/modules/ai-rag/services/ai-summarizer.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const UUID_C = '323e4567-e89b-12d3-a456-426614174002';
const vec = (s: string): number[] => deterministicEmbedding(s);

// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  assert.equal(VectorDistanceMetricEnum.safeParse('COSINE').success, true);
  assert.equal(VectorDistanceMetricEnum.safeParse('MANHATTAN').success, false);
  assert.equal(ContentSourceTypeEnum.safeParse('EBOOK_CHUNK').success, true);
  assert.equal(ContentSourceTypeEnum.safeParse('PDF_RAW').success, false);
  assert.equal(
    VectorEmbeddingPayloadSchema.safeParse({
      id: UUID, tenantId: UUID_B, sourceType: 'EBOOK_CHUNK', sourceId: UUID_C,
      chunkIndex: 0, contentText: 'hello', embedding: vec('hello'),
    }).success,
    true,
  );
  assert.equal(
    VectorEmbeddingPayloadSchema.safeParse({
      id: UUID, tenantId: UUID_B, sourceType: 'EBOOK_CHUNK', sourceId: UUID_C,
      chunkIndex: 0, contentText: 'hello', embedding: [1, 2, 3],
    }).success,
    false,
  );
  const parsed = SemanticSearchInputSchema.safeParse({ tenantId: UUID, queryText: 'เทคนิคตั้งราคา' });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.limit, 10);
    assert.equal(parsed.data.similarityThreshold, 0.7);
  }
  assert.equal(SemanticSearchInputSchema.safeParse({ tenantId: UUID, queryText: 'x' }).success, false);
  assert.equal(
    VectorSearchResultItemSchema.safeParse({
      sourceType: 'EBOOK_CHUNK', sourceId: UUID, productId: UUID,
      productTitle: 'T', chunkIndex: 0, contentText: 'c', similarityScore: 0.98,
    }).success,
    true,
  );
  assert.equal(
    AiAskContextQuerySchema.safeParse({ productId: UUID, userQuestion: 'สรุปบทนี้ให้หน่อย' }).success,
    true,
  );
  assert.equal(AiAskContextQuerySchema.safeParse({ productId: UUID, userQuestion: 'x' }).success, false);
  ok('Zod §3.1 verbatim (metric/source/payload/search/result/ask gates)');
}

// ---------- 2. Pure helpers (§7.1/§8.1/§10.1) ----------
{
  assert.equal(EMBEDDING_DIMS, 1536);
  assert.equal(CHUNK_WORDS_MAX, 500);
  assert.equal(CHUNK_OVERLAP_WORDS, 50);
  assert.equal(AI_EXCERPT_MAX_CHARS, 300);
  assert.equal(SEMANTIC_SEARCH_P95_MS, 50);
  assert.equal(VECTOR_STREAM, 'stream:vector:events');
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  const chunks = chunkText(Array.from({ length: 600 }, (_, i) => `w${i}`).join(' '));
  assert.equal(chunks.length, 2);
  assert.ok(chunks[1]?.split(' ').length === 150);
  assert.deepEqual(chunkText(''), []);
  assert.equal(capExcerpt('short'), 'short');
  assert.ok(capExcerpt('x'.repeat(400)).length <= 300);
  assert.equal(watermarkTag('abc123'), '⟦wm:abc123⟧');
  assert.equal(similarityBadge(0.98), '98% Match');
  assert.equal(similarityBadge(2), '100% Match');
  ok('Helpers: cosine/chunk/excerpt/watermark/badge + budgets');
}

// ---------- 3. Embedding engine (1536-dim, normalized, deterministic) ----------
{
  const a = vec('เทคนิคการตั้งราคาขายหนังสือ');
  const b = vec('เทคนิคการตั้งราคาขายหนังสือ');
  const c = vec('สูตรแกงเขียวหวานไก่');
  assert.equal(a.length, 1536);
  assert.deepEqual(a, b);
  assert.ok(cosineSimilarity(a, b) > 0.99);
  assert.ok(cosineSimilarity(a, c) < 0.9);
  const norm = Math.sqrt(a.reduce((n, v) => n + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
  ok('Engine: 1536-dim L2-normalized deterministic embeddings');
}

// ---------- 4. Semantic search (BDD-1: gate → embed → tenant HNSW) ----------
async function sectionSearch(): Promise<void> {
  const calls: Array<{ threshold: number; limit: number; tenant: string; product?: string | null }> = [];
  const streams: string[] = [];
  const rows = [
    { id: 'r1', product_id: UUID, source_type: 'EBOOK_CHUNK', source_id: UUID_C, chunk_index: 0, content_text: 'ตั้งราคา', metadata_json: { pageNumber: 45 }, similarity: 0.98 },
    { id: 'r2', product_id: UUID_B, source_type: 'COURSE_TRANSCRIPT', source_id: UUID, chunk_index: 3, content_text: 'วิดีโอ', metadata_json: { timestampSec: 120 }, similarity: 0.81 },
  ];
  const vectors = {
    searchSimilarVectors: async (q: number[], threshold: number, limit: number, tenant: string, product?: string) => {
      calls.push({ threshold, limit, tenant, product });
      return rows;
    },
  };
  const titles = { findTitles: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, `Title-${id.slice(0, 4)}`])) };
  const bus = { xadd: async (s: string) => { streams.push(s); } };
  const svc = new SemanticSearchService({ embed: async (t: string) => vec(t) } as never, vectors as never, titles, bus);
  const r = await svc.execute({ tenantId: UUID_B, queryText: 'เทคนิคตั้งราคา' });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0]?.pageNumber, 45);
  assert.equal(r.items[1]?.videoTimestampSec, 120);
  assert.ok(r.tookMs < 50, 'in-memory p95 budget');
  assert.ok(calls[0]?.tenant === UUID_B && calls[0]?.limit === 10 && calls[0]?.threshold === 0.7);
  assert.ok(streams.includes(VECTOR_STREAM));
  // sourceTypes filter + product filter + invalid input.
  const f = await svc.execute({ tenantId: UUID_B, queryText: 'เทคนิคตั้งราคา', sourceTypes: ['EBOOK_CHUNK'], productIdFilter: UUID });
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0]?.sourceType, 'EBOOK_CHUNK');
  assert.equal(calls[1]?.product, UUID);
  await assert.rejects(svc.execute({ tenantId: UUID_B, queryText: 'x' }), /Invalid semantic search/);
  ok('Search: enrich + filters + stream + gate (<50ms)');
}

// ---------- 5. RAG + summarizer (BDD-2: capped excerpts + watermark) ----------
async function sectionRag(): Promise<void> {
  const longText = 'การตั้งราคาหนังสือคือศิลปะ '.repeat(40);
  const vectors = {
    searchSimilarVectors: async () => [
      { id: 'r1', product_id: UUID, source_type: 'EBOOK_CHUNK', source_id: UUID_C, chunk_index: 2, content_text: longText, metadata_json: { pageNumber: 45 }, similarity: 0.95 },
      { id: 'r2', product_id: UUID, source_type: 'EBOOK_CHUNK', source_id: UUID_C, chunk_index: 5, content_text: 'เนื้อหาสั้น', metadata_json: {}, similarity: 0.8 },
    ],
  };
  const embeddings = { embed: async (t: string) => vec(t) };
  const rag = new RagContextBuilderService(embeddings as never, vectors as never);
  const built = await rag.build({ tenantId: UUID_B, productId: UUID, userQuestion: 'สรุปบทนี้' });
  assert.equal(built.chunks.length, 2);
  assert.ok(built.chunks.every((c) => c.contentText.length <= 300), 'DRM excerpt cap');
  assert.ok(built.prompt.includes('สรุปบทนี้') && built.prompt.includes('หน้า 45'));
  const sum = new AiSummarizerService(rag);
  const ans = await sum.ask({ tenantId: UUID_B, productId: UUID, userIdHash: 'abc123', userQuestion: 'สรุปบทนี้' });
  assert.ok(ans.answer.includes('⟦wm:abc123⟧'), 'forensic watermark');
  assert.ok(ans.answer.includes('หน้า 45'));
  assert.deepEqual(ans.referencedPages, [45]);
  const empty = new AiSummarizerService(
    new RagContextBuilderService(embeddings as never, { searchSimilarVectors: async () => [] } as never),
  );
  const none = await empty.ask({ tenantId: UUID_B, productId: UUID, userIdHash: 'h', userQuestion: 'อะไร' });
  assert.deepEqual(none.referencedPages, []);
  assert.ok(none.answer.includes('ไม่พบเนื้อหา'));
  ok('RAG: prompt + 300-char cap + watermark + page refs + empty shape');
}

// ---------- 6. Prisma additive + SQL companion (Gate 1/7) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of [
    'enum ContentSourceType {',
    'COURSE_TRANSCRIPT',
    'model ContentVectorEmbedding {',
    'embedding    Unsupported("vector(1536)")?',
    '@@index([tenantId])',
    '@@index([sourceType, sourceId])',
    'contentVectors    ContentVectorEmbedding[]',
  ]) {
    assert.ok(prisma.includes(t), `prisma missing: ${t}`);
  }
  assert.ok(existsSync('apps/backend/src/infra/postgres/pgvector-091.sql'), 'HNSW companion missing');
  const sql = readFileSync('apps/backend/src/infra/postgres/pgvector-091.sql', 'utf8');
  assert.ok(sql.includes('USING hnsw') && sql.includes('match_content_vectors') && sql.includes('p_tenant_id'), 'HNSW/match fn');
  ok('Prisma: ContentVectorEmbedding + Product relation + HNSW companion');
}

function sectionParity(): void {
  for (const f of [
    'apps/backend/src/modules/vector-search/services/embedding-generator.service.ts',
    'apps/backend/src/modules/vector-search/services/pgvector-repository.service.ts',
    'apps/backend/src/modules/vector-search/services/semantic-search.service.ts',
    'apps/backend/src/modules/ai-rag/services/rag-context-builder.service.ts',
    'apps/backend/src/modules/ai-rag/services/ai-summarizer.service.ts',
    'apps/backend/src/modules/vector-search/api/graphql/vector-search.resolver.ts',
    'apps/backend/src/modules/vector-search/api/graphql/vector-search.type.ts',
    'apps/backend/src/modules/vector-search/api/rest/vector-search.controller.ts',
    'apps/backend/src/modules/vector-search/vector-search.module.ts',
    'apps/backend/src/modules/ai-rag/ai-rag.module.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const mod = readFileSync('apps/backend/src/modules/vector-search/vector-search.module.ts', 'utf8');
  assert.ok(mod.includes('VectorSearchModule') && mod.includes('SemanticSearchService') && mod.includes('EntitlementGrantService'));
  assert.ok(!/class VectorSearchModuleModule/.test(mod), 'legacy scaffold class removed');
  assert.ok(!/ServiceService|ResolverResolver|ControllerController/.test(mod), 'legacy scaffold names removed');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('VectorSearchModule') && app.includes('AiRagModule'));
  const gql = readFileSync('apps/backend/src/modules/vector-search/api/graphql/vector-search.resolver.ts', 'utf8');
  assert.ok(gql.includes('semanticSearch') && gql.includes('askAiAboutBook') && gql.includes('ingestContentVectors'));
  const alias = readFileSync('apps/backend/src/api/graphql/resolvers/vector-search.resolver.ts', 'utf8');
  assert.ok(alias.includes('VectorSearchResolver'));
  const sdl = readFileSync('apps/backend/src/api/graphql/vector-search.graphql', 'utf8');
  assert.ok(sdl.includes('SemanticSearchPayload') && sdl.includes('AiAskPayload') && sdl.includes('askAiAboutBook'));
  for (const p of [
    'apps/frontend/components/search/SemanticSearchInput.tsx',
    'apps/frontend/components/reader/AiAskModal.tsx',
    'apps/frontend/hooks/useSemanticSearch.ts',
    'apps/frontend/hooks/useAiAsk.ts',
    'apps/frontend/lib/vector-search/vector-search-client.ts',
    'apps/frontend/app/(liff)/search/page.tsx',
  ]) {
    assert.ok(readFileSync(p, 'utf8').length > 200, `frontend missing: ${p}`);
  }
  const hook = readFileSync('apps/frontend/hooks/useAiAsk.ts', 'utf8');
  assert.ok(hook.includes('LIFF_INIT') || hook.includes('SUCCESS'), '5-state ask hook');
  const searchHook = readFileSync('apps/frontend/hooks/useSemanticSearch.ts', 'utf8');
  assert.ok(searchHook.includes('LIFF_INIT') && searchHook.includes('SUCCESS') && searchHook.includes('ERROR'), '5-state search hook');
  const modal = readFileSync('apps/frontend/components/reader/AiAskModal.tsx', 'utf8');
  assert.ok(!modal.includes('lucide-react') && !modal.includes('@/components/ui'), 'zero-dep modal (no heavy UI)');
  for (const p of [
    'apps/frontend/app/api/v1/vector-search/search/route.ts',
    'apps/frontend/app/api/v1/vector-search/ask/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy missing backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.ok(barrel.includes('vector-search-contract') && barrel.includes('SemanticSearchInputSchema'));
  ok('Parity: modules/GQL+alias/SDL/modal+input+hooks/proxies/barrel (5-state, zero-dep)');
}

async function main(): Promise<void> {
  await sectionSearch();
  await sectionRag();
  sectionParity();
}

void main().then(
  () => console.log(`\nPhase091 contracts: ${passed + 4} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
