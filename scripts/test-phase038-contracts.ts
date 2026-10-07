// SSOT Phase 038 §10 — contract tests (Zod, entities, pipeline, queue, wiring)
// Run: npx tsx scripts/test-phase038-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BookJobStatusEnum,
  ProcessBookJobInputSchema,
  EbookChunkMetadataSchema,
  BookPipelineStatusResponseSchema,
  PagePayloadSchema,
  SVG_PAGE_MAX_BYTES,
  PIPELINE_CHUNK_TTL_SEC,
  PIPELINE_MAX_RETRIES,
  chunkR2Path,
  progressFor,
} from '../packages/shared/src/schemas/book-pipeline.zod';
import { BookJob } from '../apps/backend/src/modules/pipeline/domain/entities/book-job.entity';
import { VectorPage } from '../apps/backend/src/modules/pipeline/domain/entities/vector-page.entity';
import { sanitizeSvg } from '../apps/backend/src/modules/pipeline/domain/services/svg-sanitizer.service';
import { compressVectorSvg } from '../apps/backend/src/modules/pipeline/domain/services/vector-compressor.service';
import { normalizePdfPages } from '../apps/backend/src/modules/pipeline/infrastructure/parsers/pdf-vector-parser.adapter';
import { epubItemToSvgPage, EpubParserAdapter } from '../apps/backend/src/modules/pipeline/infrastructure/parsers/epub-parser.adapter';
import { encryptPayload, decryptPayload, EncryptAndUploadChunkUseCase } from '../apps/backend/src/modules/pipeline/application/use-cases/encrypt-and-upload-chunk.use-case';
import { ProcessPdfToChunksUseCase } from '../apps/backend/src/modules/pipeline/application/use-cases/process-pdf-to-chunks.use-case';
import { ProcessEpubToChunksUseCase } from '../apps/backend/src/modules/pipeline/application/use-cases/process-epub-to-chunks.use-case';
import { BookJobQueue, backoffMs } from '../apps/backend/src/jobs/book-processor/book-job.queue';
import { BookPipelineProcessor } from '../apps/backend/src/modules/pipeline/infrastructure/processors/book-pipeline.processor';
import { VectorCacheService } from '../apps/backend/src/infra/redis/vector-cache';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';
// NOTE: Controllers/Resolver use Nest parameter decorators (@Body/@Args) which
// tsx/esbuild cannot transform — verified via static source parity (§7)
// following the Phase 027–037 precedent.

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Zod pipeline vocabulary + progress/keys (§3.1 Gate 1) ----------
{
  for (const s of ['QUEUED', 'PARSING_STRUCTURE', 'GENERATING_VECTOR_CHUNKS', 'ENCRYPTING_ASSETS', 'UPLOADING_R2', 'COMPLETED', 'FAILED']) {
    assert.equal(BookJobStatusEnum.safeParse(s).success, true);
  }
  assert.equal(ProcessBookJobInputSchema.safeParse({ bookId: 'b', sellerId: 's', tenantId: 't', rawFileUrl: 'https://cdn.example.com/a.pdf', fileType: 'PDF', watermarkSeed: 'seed' }).success, true);
  assert.equal(ProcessBookJobInputSchema.safeParse({ bookId: 'b', sellerId: 's', tenantId: 't', rawFileUrl: 'not-url', fileType: 'PDF', watermarkSeed: 'seed' }).success, false);
  assert.equal(EbookChunkMetadataSchema.safeParse({ bookId: 'b', pageNumber: 1, chunkR2Path: 'k', fileSizeBytes: 10, hasVectorSvg: true, extractedTextLength: 0 }).success, true);
  assert.equal(EbookChunkMetadataSchema.safeParse({ bookId: 'b', pageNumber: 0, chunkR2Path: 'k', fileSizeBytes: 10, hasVectorSvg: true, extractedTextLength: 0 }).success, false);
  assert.equal(BookPipelineStatusResponseSchema.safeParse({ jobId: 'j', bookId: 'b', status: 'COMPLETED', progressPercentage: 100, processedPages: 2, totalPages: 2, errorMessage: null }).success, true);
  assert.equal(BookPipelineStatusResponseSchema.safeParse({ jobId: '', bookId: 'b', status: 'COMPLETED', progressPercentage: 100, processedPages: 2, totalPages: 2, errorMessage: null }).success, false);
  assert.equal(PagePayloadSchema.safeParse({ pageNumber: 1, svgContent: '<svg/>' }).success, true);
  assert.equal(SVG_PAGE_MAX_BYTES, 51200);
  assert.equal(PIPELINE_CHUNK_TTL_SEC, 86400);
  assert.equal(PIPELINE_MAX_RETRIES, 3);
  assert.equal(chunkR2Path('book-1', 3), 'ebooks/book-1/chunks/page-3.enc');
  assert.equal(progressFor(0, 100), 30);
  assert.equal(progressFor(100, 100), 95);
  assert.equal(progressFor(50, 100), 62);
  assert.equal(progressFor(5, 0), 30);
  ok('Zod job/input/chunk/status/page + progress/keys/budgets');
}

// ---------- 2. Entities: job machine + page budget ----------
{
  const job = BookJob.create('PROD-1');
  assert.equal(job.props.status, 'QUEUED');
  job.transitionTo('PARSING_STRUCTURE', 10, 0, 0);
  assert.throws(() => job.transitionTo('COMPLETED', 100, 0, 0), /Illegal job transition/);
  assert.throws(() => job.transitionTo('GENERATING_VECTOR_CHUNKS', 5, 0, 0), /rewind/);
  assert.throws(() => job.transitionTo('GENERATING_VECTOR_CHUNKS', 101, 0, 0), /range/);
  job.transitionTo('GENERATING_VECTOR_CHUNKS', 30, 0, 2);
  job.transitionTo('ENCRYPTING_ASSETS', 30, 0, 2);
  job.transitionTo('UPLOADING_R2', 95, 2, 2);
  job.transitionTo('COMPLETED', 100, 2, 2);
  assert.throws(() => BookJob.create(''), /Missing product/);
  assert.throws(() => BookJob.rehydrate({ productId: 'p', status: 'NOPE' as never, progressPercentage: 0, totalPages: 0, processedPages: 0 }), /Unknown job status/);
  const failed = BookJob.rehydrate({ productId: 'p', status: 'FAILED', progressPercentage: 40, totalPages: 2, processedPages: 1 });
  failed.transitionTo('QUEUED', 0, 0, 0);

  assert.equal(VectorPage.create({ pageNumber: 1, svgContent: '<svg/>', extractedText: 'hi' }).props.pageNumber, 1);
  assert.throws(() => VectorPage.create({ pageNumber: 0, svgContent: '<svg/>', extractedText: '' }), /Invalid page/);
  assert.throws(() => VectorPage.create({ pageNumber: 1, svgContent: '', extractedText: '' }), /Empty SVG/);
  assert.throws(() => VectorPage.create({ pageNumber: 1, svgContent: `x${'y'.repeat(SVG_PAGE_MAX_BYTES)}`, extractedText: '' }), /50KB/);
  ok('Job legal/illegal/rewind/requeue transitions + page budget guards');
}

// ---------- 3. Sanitizer + compressor pure transforms ----------
{
  const dirty = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>alert(1)</script><style>.x{}</style><foreignObject><div>html</div></foreignObject><rect onclick="x()" xlink:href="javascript:evil()" href="data:text/html,<b>x</b>" width="10"/></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.ok(!clean.includes('<script') && !clean.includes('onload') && !clean.includes('onclick'));
  assert.ok(!clean.includes('javascript:') && !clean.includes('data:text/html') && !clean.includes('DOCTYPE') && !clean.includes('foreignObject'));
  assert.ok(clean.includes('<svg') && clean.includes('<rect'));
  assert.throws(() => sanitizeSvg(''), /Empty SVG/);
  assert.throws(() => sanitizeSvg('<div>nope</div>'), /Not an SVG/);

  const report = compressVectorSvg('<!-- c --><svg>  <rect  />\n  <circle /> </svg>');
  assert.ok(report.afterBytes < report.beforeBytes && report.output.includes('<svg><rect'));
  assert.throws(() => compressVectorSvg(''), /Empty SVG/);
  ok('Sanitizer strips XXE/scripts/handlers/URIs; compressor collapses + reports');
}

// ---------- 4. Parsers: PDF normalize + EPUB text-layer transform ----------
{
  const book = normalizePdfPages([
    { pageNumber: 2, svgContent: '<svg>2</svg>', extractedText: 'two' },
    { pageNumber: 1, svgContent: '<svg>1</svg>' },
  ]);
  assert.equal(book.totalPages, 2);
  assert.deepEqual(book.pages.map((p) => p.pageNumber), [1, 2]);
  assert.equal(book.pages[0].extractedText, '');
  assert.throws(() => normalizePdfPages([]), /No rendered pages/);
  assert.throws(() => normalizePdfPages([{ pageNumber: 1, svgContent: 'x' }, { pageNumber: 1, svgContent: 'y' }]), /Duplicate/);
  assert.throws(() => normalizePdfPages([{ pageNumber: 1, svgContent: 'x' }, { pageNumber: 3, svgContent: 'y' }]), /dense/);
  assert.throws(() => normalizePdfPages([{ pageNumber: 1, svgContent: '' }]), /Empty SVG/);

  const page = epubItemToSvgPage(1, '<h1>Title</h1><p>Hello <b>world</b> & friends</p><script>evil()</script>');
  assert.ok(page.svgContent.includes('Hello world &amp; friends') && page.svgContent.includes('<text'));
  assert.ok(!page.svgContent.includes('<script'));
  assert.ok(page.extractedText.includes('Title'));
  assert.throws(() => epubItemToSvgPage(0, '<p>x</p>'), /Invalid page/);
  assert.throws(() => epubItemToSvgPage(1, '   '), /Empty EPUB/);
  const adapter = new EpubParserAdapter();
  assert.equal(adapter.parseToVectorSvgs([{ idref: 'ch1', xhtmlContent: '<p>A</p>' }, { idref: 'ch2', xhtmlContent: '<p>B</p>' }]).totalPages, 2);
  assert.throws(() => adapter.parseToVectorSvgs([]), /No EPUB spine/);
  ok('PDF dense-sequence normalize; EPUB XHTML→SVG text layer + escaping');
}

async function main(): Promise<void> {
// ---------- 5. AES-256-GCM envelope: round-trip + upload path ----------
{
  const envelope = encryptPayload('<svg>secret</svg>', 'seed-1', 'book-1');
  assert.equal(envelope.hash.length, 64);
  assert.equal(envelope.iv.length, 24);
  assert.equal(decryptPayload(envelope, 'seed-1', 'book-1'), '<svg>secret</svg>');
  assert.throws(() => decryptPayload(envelope, 'wrong-seed', 'book-1'), /unable to authenticate|Unsupported state/i);
  assert.throws(() => encryptPayload('', 's', 'b'), /Empty chunk/);
  assert.throws(() => encryptPayload('x', '', 'b'), /Missing encryption/);

  const puts: string[] = [];
  const vault = { uploadBuffer: async (k: string) => { puts.push(k); return { eTag: 'e' }; }, readText: async () => '' };
  const useCase = new EncryptAndUploadChunkUseCase(vault as never);
  const out = await useCase.execute('ebooks/b/chunks/page-1.enc', '<svg>x</svg>', 'seed-1', 'book-1');
  assert.equal(puts[0], 'ebooks/b/chunks/page-1.enc');
  assert.equal(decryptPayload(out, 'seed-1', 'book-1'), '<svg>x</svg>');
  ok('GCM envelope round-trips; wrong seed fails auth; upload path records key');
}

// ---------- 6. PDF use-case: stage pipeline + upserts + progress + guards ----------
{
  const chunkUpserts: unknown[] = [];
  const textUpserts: unknown[] = [];
  const progress: Array<[number, number, number]> = [];
  const prisma = {
    ebookDetail: { findFirst: async () => ({ id: 'ebook-9' }) },
    ebookChunk: { upsert: async (a: unknown) => { chunkUpserts.push(a); return {}; } },
    ebookPageText: { upsert: async (a: unknown) => { textUpserts.push(a); return {}; } },
  } as unknown as PrismaService;
  const fakeVault = {
    uploadBuffer: async () => ({ eTag: 'e' }),
    readText: async () => '',
  };
  const { PdfVectorParserAdapter } = await import('../apps/backend/src/modules/pipeline/infrastructure/parsers/pdf-vector-parser.adapter');
  const { SvgSanitizerService } = await import('../apps/backend/src/modules/pipeline/domain/services/svg-sanitizer.service');
  const { VectorCompressorService } = await import('../apps/backend/src/modules/pipeline/domain/services/vector-compressor.service');
  const { EncryptAndUploadChunkUseCase: EUC } = await import('../apps/backend/src/modules/pipeline/application/use-cases/encrypt-and-upload-chunk.use-case');
  const useCase = new ProcessPdfToChunksUseCase(prisma, new PdfVectorParserAdapter(), new SvgSanitizerService(), new VectorCompressorService(), new EUC(fakeVault as never));
  const results = await useCase.execute('book-9', 'PROD-9', 'seed-9', [
    { pageNumber: 1, svgContent: '<svg><rect onload="x"/></svg>', extractedText: 'page one' },
    { pageNumber: 2, svgContent: '<svg><circle/></svg>', extractedText: '' },
  ], async (done, total, pct) => { progress.push([done, total, pct]); });
  assert.equal(results.length, 2);
  assert.equal(results[0].r2ObjectKey, 'ebooks/book-9/chunks/page-1.enc');
  assert.equal(results[0].textLength, 8);
  assert.deepEqual(progress, [[1, 2, 62], [2, 2, 95]]);
  assert.equal(chunkUpserts.length, 2);
  assert.equal(textUpserts.length, 2);
  assert.deepEqual((chunkUpserts[0] as { where: unknown }).where, { ebookDetailId_pageNumber: { ebookDetailId: 'ebook-9', pageNumber: 1 } });

  const unknown = new ProcessPdfToChunksUseCase(
    { ebookDetail: { findFirst: async () => null } } as unknown as PrismaService,
    new PdfVectorParserAdapter(), new SvgSanitizerService(), new VectorCompressorService(), new EUC(fakeVault as never),
  );
  await assert.rejects(() => unknown.execute('b', 'GHOST', 's', [{ pageNumber: 1, svgContent: '<svg/>', extractedText: '' }]), /EbookDetail record not found/);
  await assert.rejects(
    () => useCase.execute('book-9', 'PROD-9', 'seed-9', [{ pageNumber: 1, svgContent: `<svg>${'y'.repeat(SVG_PAGE_MAX_BYTES)}</svg>`, extractedText: '' }]),
    /50KB/,
  );
  ok('PDF stages sanitize/compress/encrypt/upload/upsert/text + progress rule + guards');
}

// ---------- 7. EPUB delegation + queue FIFO/retry/DLQ + processor lifecycle ----------
{
  const { ProcessEpubToChunksUseCase } = await import('../apps/backend/src/modules/pipeline/application/use-cases/process-epub-to-chunks.use-case');
  let delegated: unknown = null;
  const fakeCore = { execute: async (...args: unknown[]) => { delegated = args; return [{ pageNumber: 1 }]; } } as unknown as ProcessPdfToChunksUseCase;
  const { EpubParserAdapter: EA } = await import('../apps/backend/src/modules/pipeline/infrastructure/parsers/epub-parser.adapter');
  const epub = new ProcessEpubToChunksUseCase(new EA(), fakeCore);
  const out = await epub.execute('b', 'p', 's', [{ idref: 'ch1', xhtmlContent: '<p>Hi</p>' }]);
  assert.equal(out.length, 1);
  assert.equal((delegated as unknown[])[0], 'b');
  await assert.rejects(() => epub.execute('b', 'p', 's', []), /No EPUB spine/);

  assert.equal(backoffMs(1), 500);
  assert.equal(backoffMs(2), 1000);
  assert.equal(backoffMs(3), 2000);
  const order: string[] = [];
  const queue = new BookJobQueue(2);
  queue.enqueue({ jobId: 'j1', productId: 'p', run: async () => { order.push('j1'); } });
  let flaky = 0;
  queue.enqueue({
    jobId: 'j2', productId: 'p',
    run: async () => {
      flaky++;
      if (flaky === 1) throw new Error('transient');
      order.push('j2');
    },
  });
  queue.enqueue({ jobId: 'j3', productId: 'p', run: async () => { throw new Error('poison'); } });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.deepEqual(order, ['j1', 'j2']);
  assert.equal(queue.deadLetters.length, 1);
  assert.equal(queue.deadLetters[0].jobId, 'j3');
  assert.equal(queue.deadLetters[0].attempts, 2);

  const marks: string[] = [];
  const procPrisma = {
    bookProcessingJob: { upsert: async (a: unknown) => { marks.push((a as { update: { status: string } }).update.status); return {}; } },
  } as unknown as PrismaService;
  const fakePdf = { execute: async () => [{ pageNumber: 1, r2ObjectKey: 'k', chunkSizeBytes: 10, vectorChecksum: 'h', textLength: 1 }] } as unknown as ProcessPdfToChunksUseCase;
  const fakeEpub = { execute: async () => [] } as unknown as ProcessEpubToChunksUseCase;
  const processor = new BookPipelineProcessor(procPrisma, fakePdf, fakeEpub);
  const done = await processor.processJob({ productId: 'PROD-1', bookId: 'book-1', watermarkSeed: 's', fileType: 'PDF', pages: [{ pageNumber: 1, svgContent: '<svg/>', extractedText: '' }] });
  assert.equal(done.totalPages, 1);
  assert.ok(marks.includes('PARSING_STRUCTURE') && marks.includes('COMPLETED'));
  const failing = new BookPipelineProcessor(
    {
      bookProcessingJob: {
        upsert: async (a: unknown) => { marks.push(`F:${((a as { update: { status: string } }).update.status)}`); return {}; },
      },
    } as unknown as PrismaService,
    { execute: async () => { throw new Error('raster boom'); } } as unknown as ProcessPdfToChunksUseCase,
    fakeEpub,
  );
  await assert.rejects(() => failing.processJob({ productId: 'P', bookId: 'b', watermarkSeed: 's', fileType: 'PDF', pages: [{ pageNumber: 1, svgContent: '<svg/>', extractedText: '' }] }), /raster boom/);
  assert.ok(marks.some((m) => m === 'F:FAILED'));
  ok('EPUB delegates spine→core; queue FIFO + 1-retry + DLQ; processor COMPLETED/FAILED lifecycle');
}

// ---------- 8. Vector cache + wiring + controller/resolver/DTO/SDL parity ----------
{
  const store = new Map<string, string>();
  const cache = new VectorCacheService({
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
  } as unknown as RedisClusterService);
  assert.equal(cache.key('ebooks/b/chunks/page-1.enc'), 'r2:chunk:ebooks/b/chunks/page-1.enc');
  await cache.set('k', 'v');
  assert.equal(await cache.get('k'), 'v');
  await cache.del('k');
  assert.equal(await cache.get('k'), null);

  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum BookJobStatus', 'model BookProcessingJob', 'model EbookChunk', 'model EbookPageText', 'chunks', 'pageTexts', 'bookProcessingJob', '@@unique([ebookDetailId, pageNumber])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const mod = readFileSync('apps/backend/src/modules/pipeline/pipeline.module.ts', 'utf8');
  for (const t of ['BookPipelineProcessor', 'BookPipelineController', 'BookPipelineResolver', 'ProcessPdfToChunksUseCase', 'R2StorageModule']) {
    assert.ok(mod.includes(t), `module missing ${t}`);
  }
  assert.ok(readFileSync('apps/backend/src/app.module.ts', 'utf8').includes('PipelineModule'));
  const ctlSrc = readFileSync('apps/backend/src/modules/pipeline/presentation/controllers/book-pipeline.controller.ts', 'utf8');
  for (const t of ['api/v1/book-pipeline', "'start'", "'status'", "'retry'", 'JwtAuthGuard', 'BookJobQueue']) {
    assert.ok(ctlSrc.includes(t), `controller missing ${t}`);
  }
  const resolverSrc = readFileSync('apps/backend/src/modules/pipeline/presentation/resolvers/book-pipeline.resolver.ts', 'utf8');
  assert.ok(resolverSrc.includes('getBookPipelineStatus'));
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/book-pipeline.graphql/schema.graphql', 'utf8');
  assert.ok(sdl.includes('BookPipelineStatusPayload') && sdl.includes('getBookPipelineStatus'));
  const dtoSrc = readFileSync('apps/backend/src/modules/pipeline/application/dto/pipeline-job.dto.ts', 'utf8');
  assert.ok(dtoSrc.includes("from '@repo/shared'") && dtoSrc.includes('ProcessBookJobInputSchema'));
  for (const [f, marker] of [
    ['apps/backend/src/infra/cloudflare/r2-client.ts', 'R2StorageService'],
    ['apps/backend/src/infra/redis/vector-cache.ts', 'PIPELINE_CHUNK_TTL_SEC'],
  ] as Array<[string, string]>) {
    assert.ok(readFileSync(f, 'utf8').includes(marker), `${f} missing ${marker}`);
  }
  ok('Vector cache CRUD; Prisma pipeline tables; module wired; controller/resolver/DTO/SDL parity');
}

console.log(`\nPhase 038 contracts: ${passed} checks passed`);
}

void main();
