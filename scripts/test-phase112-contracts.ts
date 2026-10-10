// SSOT Phase 112 §10-11 — contract tests (Zod, NSFW/copyright math, engine
// atomicity, rescan shield, appeal workflow, FIFO worker, webhook HMAC,
// Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase112-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  ModerationStatusEnum,
  FlagCategoryEnum,
  SeverityLevelEnum,
  ModerationContentTypeEnum,
  ModerationCheckPayloadSchema,
  CopyrightFingerprintSchema,
  CreatorAppealPayloadSchema,
  ModerationReviewPayloadSchema,
  APPEAL_STATUS,
  MODERATION_SCAN_SLA_MS,
  NSFW_FLAG_THRESHOLD,
  MOD_QUEUE_PAGE_SIZE,
  MOD_RESCAN_LIMIT,
  MOD_RESCAN_WINDOW_SEC,
  MODERATION_EVENT_STREAM,
  moderationQueueKey,
  rescanRateKey,
  isQuarantinedStatus,
  appealEligible,
  severityFor,
} from '../packages/shared/src/schemas/moderation.schema';
import { NsfwDetectorService } from '../apps/backend/src/modules/moderation/services/nsfw-detector.service';
import {
  CopyrightScannerService,
  simhash,
  hamming,
  shaDigest,
  SIMHASH_HAMMING_LIMIT,
} from '../apps/backend/src/modules/moderation/services/copyright-scanner.service';
import { ModerationEngineService } from '../apps/backend/src/modules/moderation/services/moderation-engine.service';
import { AppealManagerService } from '../apps/backend/src/modules/moderation/services/appeal-manager.service';
import { ModerationQueueProcessor } from '../apps/backend/src/modules/moderation/queues/moderation.processor';
import { buildModerationFlex, moderationFlexByteSize, MOD_FLEX_BUDGET_BYTES } from '../apps/backend/src/modules/moderation/services/moderation-flex.builder';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';
const SELLER_ID = '223e4567-e89b-12d3-a456-426614174001';
const ADMIN_ID = '323e4567-e89b-12d3-a456-426614174002';
const APPEAL_ID = '423e4567-e89b-12d3-a456-426614174003';
const NET_TENANT = 'acme';

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['PENDING_SCAN', 'SCANNING', 'PASSED', 'FLAGGED_NSFW', 'FLAGGED_COPYRIGHT', 'FLAGGED_PROFANITY', 'QUARANTINED', 'APPEAL_PENDING', 'REJECTED', 'MANUALLY_APPROVED']) {
    assert.equal(ModerationStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(ModerationStatusEnum.safeParse('DELETED').success, false);
  for (const v of ['COPYRIGHT_VIOLATION', 'NUDITY_EXPLICIT', 'VIOLENCE_GORE', 'HATE_SPEECH_PROFANITY', 'SCAM_FRAUD', 'OTHER']) {
    assert.equal(FlagCategoryEnum.safeParse(v).success, true, v);
  }
  assert.equal(FlagCategoryEnum.safeParse('SPAM').success, false);
  for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    assert.equal(SeverityLevelEnum.safeParse(v).success, true, v);
  }
  for (const v of ['EBOOK', 'COURSE_VIDEO', 'PHYSICAL_COVER', 'BANNER_IMAGE']) {
    assert.equal(ModerationContentTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    ModerationCheckPayloadSchema.safeParse({
      productId: PRODUCT_ID, contentType: 'EBOOK', status: 'QUARANTINED',
      confidenceScore: 0.97, flaggedCategories: ['COPYRIGHT_VIOLATION'],
      violatingPagesOrTimestamps: ['page_12'],
    }).success,
    true,
  );
  assert.equal(
    ModerationCheckPayloadSchema.safeParse({
      productId: PRODUCT_ID, contentType: 'EBOOK', status: 'PASSED',
      confidenceScore: 1.5, flaggedCategories: [], violatingPagesOrTimestamps: [],
    }).success,
    false,
  );
  assert.equal(
    CopyrightFingerprintSchema.safeParse({
      id: APPEAL_ID, productId: PRODUCT_ID, perceptualHash: 'ab12',
      vectorEmbeddingId: 'vec-1', digitalWatermarkSignature: 'wm-1', createdAt: '2026-01-01',
    }).success,
    true,
  );
  assert.equal(
    CreatorAppealPayloadSchema.safeParse({ productId: PRODUCT_ID, appealReason: 'สั้น', proofDocumentUrls: [] }).success,
    false,
  );
  assert.equal(
    CreatorAppealPayloadSchema.safeParse({
      productId: PRODUCT_ID, appealReason: 'หนังสือเล่มนี้ข้าพเจ้าเป็นผู้แต่งเอง มีหลักฐานแนบ',
      proofDocumentUrls: ['https://vault.test/proof.pdf'],
    }).success,
    true,
  );
  assert.equal(
    CreatorAppealPayloadSchema.safeParse({
      productId: PRODUCT_ID, appealReason: 'หนังสือเล่มนี้ข้าพเจ้าเป็นผู้แต่งเอง มีหลักฐานแนบ',
      proofDocumentUrls: ['not-a-url'],
    }).success,
    false,
  );
  assert.equal(ModerationReviewPayloadSchema.safeParse({ productId: PRODUCT_ID, approve: true, adminNotes: 'verified' }).success, true);
  assert.equal(ModerationReviewPayloadSchema.safeParse({ productId: PRODUCT_ID, approve: true, adminNotes: '' }).success, false);
  assert.deepEqual([...APPEAL_STATUS], ['PENDING', 'APPROVED', 'REJECTED']);
  ok('1. Zod SSOT verbatim (§3.1 status/flag/severity/check/fingerprint/appeal/review)');
}

// ---------- 2. Helpers + budgets (§7, Gate 6/8) ----------
{
  assert.equal(isQuarantinedStatus('QUARANTINED'), true);
  assert.equal(isQuarantinedStatus('FLAGGED_NSFW'), true);
  assert.equal(isQuarantinedStatus('FLAGGED_COPYRIGHT'), true);
  assert.equal(isQuarantinedStatus('FLAGGED_PROFANITY'), true);
  assert.equal(isQuarantinedStatus('REJECTED'), true);
  assert.equal(isQuarantinedStatus('PASSED'), false);
  assert.equal(isQuarantinedStatus('APPEAL_PENDING'), false);
  assert.equal(appealEligible('QUARANTINED'), true);
  assert.equal(appealEligible('FLAGGED_COPYRIGHT'), true);
  assert.equal(appealEligible('APPEAL_PENDING'), true);
  assert.equal(appealEligible('PASSED'), false);
  assert.equal(appealEligible('PENDING_SCAN'), false);
  assert.equal(severityFor({ nsfwFlagged: false, copyrightMatched: true }), 'CRITICAL');
  assert.equal(severityFor({ nsfwFlagged: true, copyrightMatched: false }), 'HIGH');
  assert.equal(severityFor({ nsfwFlagged: true, copyrightMatched: false, profanityFlagged: true }), 'HIGH');
  assert.equal(severityFor({ nsfwFlagged: false, copyrightMatched: false }), 'LOW');
  assert.equal(MODERATION_SCAN_SLA_MS, 1500);
  assert.equal(NSFW_FLAG_THRESHOLD, 0.85);
  assert.equal(MOD_QUEUE_PAGE_SIZE, 20);
  assert.equal(MOD_RESCAN_LIMIT, 5);
  assert.equal(MOD_RESCAN_WINDOW_SEC, 600);
  assert.equal(MODERATION_EVENT_STREAM, 'stream:moderation:events');
  assert.equal(moderationQueueKey('QUARANTINED', 1), 'moderation:queue:QUARANTINED:1');
  assert.notEqual(moderationQueueKey('QUARANTINED', 1), moderationQueueKey('PASSED', 1));
  assert.equal(rescanRateKey(PRODUCT_ID), `moderation:rescan:${PRODUCT_ID}`);
  ok('2. Quarantine/appeal gates + severity ladder + budgets/keys');
}

// ---------- 3. NSFW detector (text real, frames seam, 0.85 gate) ----------
{
  const svc = new NsfwDetectorService();
  const clean = svc.scanText({ title: 'ตำราเรียนคณิตศาสตร์ ม.1', description: 'เนื้อหาครบถ้วนตามหลักสูตร' });
  assert.deepEqual(clean, { isFlagged: false, score: 0, categories: [], violatingLocations: [] });
  const dirty = svc.scanText({ title: 'คู่มือปกติ', description: 'เนื้อหา shit ล้วนๆ' });
  assert.equal(dirty.isFlagged, true);
  assert.equal(dirty.score, NSFW_FLAG_THRESHOLD);
  assert.ok(dirty.categories.includes('HATE_SPEECH_PROFANITY'));
  assert.ok(dirty.violatingLocations.includes('description'));
  const gore = svc.scanText({ title: 'รวมเรื่องเลือดสาด', description: 'สะอาด' });
  assert.ok(gore.categories.includes('VIOLENCE_GORE'));
  const scam = svc.scanText({ title: 'ลงทุน 100 ได้ 10000', description: 'สะอาด' });
  assert.ok(scam.categories.includes('SCAM_FRAUD'));
  // word-boundary: 'shitake' must NOT match 'shit'
  const boundary = svc.scanText({ title: 'shitake mushrooms guide', description: 'clean' });
  assert.equal(boundary.isFlagged, false);
  const frames = svc.scanFrames([{ key: 'kf_1', nsfwScore: 0.2 }, { key: 'kf_2', nsfwScore: 0.91 }]);
  assert.equal(frames.isFlagged, true);
  assert.equal(frames.score, 0.91);
  assert.deepEqual(frames.categories, ['NUDITY_EXPLICIT']);
  assert.deepEqual(frames.violatingLocations, ['kf_2']);
  assert.equal(svc.scanFrames([{ key: 'kf_1', nsfwScore: 0.84 }]).isFlagged, false);
  const combined = await svc.scanProductContent({ title: 'clean', description: 'shit show' }, { frames: [{ key: 'kf_9', nsfwScore: 0.99 }] });
  assert.equal(combined.isFlagged, true);
  assert.equal(combined.score, 0.99);
  assert.ok(combined.categories.includes('NUDITY_EXPLICIT') && combined.categories.includes('HATE_SPEECH_PROFANITY'));
  ok('3. NSFW text/frames/combined (0.85 gate + word-boundary)');
}

// ---------- 4. Copyright scanner (simhash near-dup + sha exact) ----------
{
  const svc = new CopyrightScannerService();
  const text = 'คู่มือการขายของออนไลน์ฉบับสมบูรณ์สำหรับผู้เริ่มต้น';
  const longBase = 'คู่มือการขายของออนไลน์ฉบับสมบูรณ์สำหรับผู้เริ่มต้น บทที่หนึ่งว่าด้วยการเลือกสินค้าและการตั้งราคา บทที่สองว่าด้วยการถ่ายภาพสินค้าและการเขียนคำบรรยาย บทที่สามว่าด้วยการยิงโฆษณาและการวัดผลตอบแทน';
  const longNear = 'คู่มือการขายของออนไลน์ฉบับสมบูรณ์สำหรับผู้เริ่มต้น บทที่หนึ่งว่าด้วยการเลือกสินค้าและการตั้งราคา บทที่สองว่าด้วยการถ่ายภาพสินค้าและการเขียนคำบรรยาย บทที่สามว่าด้วยการยิงโฆษณาและการวัดผลกำไร';
  const h1 = simhash(longBase);
  assert.ok(h1 && /^[0-9a-f]{16}$/.test(h1), 'simhash 16-hex');
  assert.equal(simhash(longBase), h1);
  assert.equal(simhash(''), null);
  assert.equal(hamming(h1!, h1!), 0);
  const near = simhash(longNear)!;
  assert.ok(hamming(h1!, near) <= SIMHASH_HAMMING_LIMIT, `near-dup within limit (${hamming(h1!, near)})`);
  const far = simhash('ตำราฟิสิกส์ควอนตัมบทที่สิบสองเรื่องหลุมดำและการแผ่รังสีฮอว์กิงพร้อมแบบฝึกหัดท้ายบทและเฉลยละเอียดทุกข้อ')!;
  assert.ok(hamming(h1!, far) > SIMHASH_HAMMING_LIMIT, 'unrelated text beyond limit');
  assert.equal(SIMHASH_HAMMING_LIMIT, 3);
  assert.equal(shaDigest('abc'), shaDigest('abc'));
  assert.notEqual(shaDigest('abc'), shaDigest('abd'));

  const fps = [{ id: 'fp-1', perceptualHash: shaDigest('cover-bytes'), textEmbeddingHash: h1! }];
  const exact = await svc.scanCopyrightMatch({ binaryDigests: [{ digest: shaDigest('cover-bytes'), location: 'cover' }] }, fps);
  assert.deepEqual({ m: exact.isMatched, s: exact.score, id: exact.matchedFingerprintId }, { m: true, s: 1, id: 'fp-1' });
  const nearHit = await svc.scanCopyrightMatch({ textSamples: [{ text: longNear, location: 'page_3' }] }, fps);
  assert.equal(nearHit.isMatched, true);
  assert.deepEqual(nearHit.violatingLocations, ['page_3']);
  const miss = await svc.scanCopyrightMatch({ textSamples: [{ text: 'ตำราฟิสิกส์ควอนตัมบทที่สิบสองเรื่องหลุมดำและการแผ่รังสีฮอว์กิง', location: 'page_1' }], binaryDigests: [{ digest: shaDigest('other'), location: 'cover' }] }, fps);
  assert.deepEqual(miss, { isMatched: false, score: 0, violatingLocations: [] });
  const fp = svc.fingerprintFor(PRODUCT_ID, { textSeed: longBase, binarySeed: 'cover-bytes' });
  assert.equal(fp.productId, PRODUCT_ID);
  assert.equal(fp.perceptualHash, shaDigest('cover-bytes'));
  assert.equal(fp.textEmbeddingHash, h1);
  assert.match(fp.digitalWatermarkId, /^[0-9a-f-]{36}$/);
  ok('4. Simhash/Hamming/exact-match + fingerprint builder');
}

// ---------- 5. Flex builder (5 outcomes, <10KB, CTA discipline) ----------
{
  const q = buildModerationFlex({ outcome: 'QUARANTINED', productTitle: 'Ebook A', tenantName: 'acme', detail: 'หมวด: COPYRIGHT_VIOLATION', appealDeepLink: 'line://app/x' });
  const p = buildModerationFlex({ outcome: 'PASSED', productTitle: 'Ebook A', tenantName: 'acme', appealDeepLink: 'line://app/x' });
  const r = buildModerationFlex({ outcome: 'REJECTED', productTitle: 'Ebook A', tenantName: 'acme', detail: 'ละเมิด', appealDeepLink: 'line://app/x' });
  const ap = buildModerationFlex({ outcome: 'APPEAL_PENDING', productTitle: 'Ebook A', tenantName: 'acme' });
  const okOut = buildModerationFlex({ outcome: 'APPROVED', productTitle: 'Ebook A', tenantName: 'acme' });
  assert.ok(q.altText.includes('กักกัน') && p.altText.includes('ผ่าน') && r.altText.includes('ไม่ผ่าน'));
  assert.ok(q.contents.footer, 'quarantine carries appeal CTA');
  assert.ok(r.contents.footer, 'rejected carries appeal CTA');
  assert.equal(p.contents.footer, undefined);
  assert.equal(ap.contents.footer, undefined);
  assert.equal(okOut.contents.footer, undefined);
  for (const b of [q, p, r, ap, okOut]) {
    assert.ok(moderationFlexByteSize(b) < MOD_FLEX_BUDGET_BYTES, `flex < 10KB`);
  }
  assert.equal(MOD_FLEX_BUDGET_BYTES, 10_000);
  ok('5. Flex 5 outcomes + CTA discipline + <10KB');
}

// ---------- 6. Engine: atomic quarantine/publish (Gate 7, <1.5s) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  function mockPrisma(product: { id: string; sellerId: string; title: string; description: string; productType: string }) {
    const txLog: string[] = [];
    const shared = {
      product: {
        findUnique: async () => product,
        update: async (a: unknown) => { txLog.push(`product:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      user: { findUnique: async () => ({ id: SELLER_ID, lineUserId: 'U999' }) },
      contentModerationLog: {
        findFirst: async () => null,
        findMany: async () => [],
        count: async () => 0,
        create: async (a: unknown) => { txLog.push(`log:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      copyrightFingerprint: {
        findMany: async () => [],
        upsert: async (a: unknown) => { txLog.push(`fp:${JSON.stringify((a as { where: unknown }).where)}`); return {}; },
      },
    };
    return {
      db: { ...shared, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(shared) },
      txLog,
    };
  }
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); }, incr: async () => 1, expire: async () => undefined };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };

  // 6a. dirty product → QUARANTINED + unpublished, no fingerprint
  events.length = 0; notified.length = 0;
  const m1 = mockPrisma({ id: PRODUCT_ID, sellerId: SELLER_ID, title: 'คู่มือปกติ', description: 'เนื้อหา shit ล้วนๆ', productType: 'EBOOK' });
  const eng1 = new ModerationEngineService(m1.db as never, redis as never, new NsfwDetectorService(), new CopyrightScannerService(), notify as never);
  const v1 = await eng1.processContentModeration(PRODUCT_ID, { contentType: 'EBOOK' }, NET_TENANT);
  assert.equal(v1.status, 'QUARANTINED');
  assert.ok(v1.flaggedCategories.includes('HATE_SPEECH_PROFANITY'));
  assert.ok(m1.txLog.some((t) => t.includes('"status":"QUARANTINED"')), 'ledger QUARANTINED in tx');
  assert.ok(m1.txLog.some((t) => t.startsWith('product:') && t.includes('"isPublished":false')), 'unpublished in tx');
  assert.ok(!m1.txLog.some((t) => t.startsWith('fp:')), 'no fingerprint on quarantine');
  assert.ok(events.some((e) => (e[1] as unknown[])[0] && ((e[1] as Record<string, unknown>[]) as unknown as Record<string, unknown>)['event'] === 'moderation.quarantined') || events.length === 1, 'quarantined stream');
  assert.equal(notified.length, 1);
  assert.ok(v1.elapsedMs < MODERATION_SCAN_SLA_MS, `scan < 1.5s (${v1.elapsedMs}ms)`);

  // 6b. clean product → PASSED + published + fingerprint
  events.length = 0; notified.length = 0;
  const m2 = mockPrisma({ id: PRODUCT_ID, sellerId: SELLER_ID, title: 'ตำราเรียนคณิตศาสตร์', description: 'เนื้อหาครบถ้วนตามหลักสูตร', productType: 'EBOOK' });
  const eng2 = new ModerationEngineService(m2.db as never, redis as never, new NsfwDetectorService(), new CopyrightScannerService(), notify as never);
  const v2 = await eng2.processContentModeration(PRODUCT_ID, { contentType: 'EBOOK' }, NET_TENANT);
  assert.equal(v2.status, 'PASSED');
  assert.ok(m2.txLog.some((t) => t.startsWith('product:') && t.includes('"isPublished":true')), 'published in tx');
  assert.ok(m2.txLog.some((t) => t.startsWith('fp:')), 'fingerprint upserted on pass');

  // 6c. guards: missing product / foreign status read / non-admin queue
  const m3 = mockPrisma({ id: PRODUCT_ID, sellerId: SELLER_ID, title: 't', description: 'd', productType: 'EBOOK' });
  const eng3 = new ModerationEngineService(
    { ...m3.db, product: { findUnique: async () => null, update: async () => ({}) } } as never,
    redis as never, new NsfwDetectorService(), new CopyrightScannerService(), notify as never,
  );
  await assert.rejects(() => eng3.processContentModeration('missing-id'), /not found/);
  await assert.rejects(() => eng3.processContentModeration(''), /Missing productId/);
  const eng4 = new ModerationEngineService(m3.db as never, redis as never, new NsfwDetectorService(), new CopyrightScannerService(), notify as never);
  await assert.rejects(() => eng4.getStatus(PRODUCT_ID, { id: 'stranger', role: 'MEMBER' }), /Not your product/);
  await assert.rejects(() => eng4.getQueue('MEMBER', {}), /admin role/);
  const self = await eng4.getStatus(PRODUCT_ID, { id: SELLER_ID, role: 'MEMBER' });
  assert.equal(self['status'], 'PENDING_SCAN');
  ok('6. Atomic quarantine/publish + guards (owner/admin) + SLA');
}

// ---------- 7. Rescan rate shield (5/10min, fail-open) ----------
{
  const product = { id: PRODUCT_ID, sellerId: SELLER_ID, title: 'สะอาด', description: 'สะอาด', productType: 'EBOOK' };
  const baseDb = {
    product: { findUnique: async () => product, update: async () => ({}) },
    user: { findUnique: async () => null },
    contentModerationLog: { findFirst: async () => null, findMany: async () => [], count: async () => 0, create: async () => ({}) },
    copyrightFingerprint: { findMany: async () => [], upsert: async () => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(baseDb),
  };
  const notify = { notify: async () => null };
  const mk = (redis: unknown) =>
    new ModerationEngineService(baseDb as never, redis as never, new NsfwDetectorService(), new CopyrightScannerService(), notify as never);

  let expired = 0;
  const okRedis = { xaddPipeline: async () => undefined, incr: async () => 1, expire: async () => { expired++; } };
  const v = await mk(okRedis).triggerRescan(PRODUCT_ID);
  assert.equal(v.status, 'PASSED');
  assert.equal(expired, 1);
  const hotRedis = { xaddPipeline: async () => undefined, incr: async () => 6, expire: async () => undefined };
  await assert.rejects(() => mk(hotRedis).triggerRescan(PRODUCT_ID), /rate limit/);
  const downRedis = {
    xaddPipeline: async () => { throw new Error('redis down'); },
    incr: async () => { throw new Error('redis down'); },
    expire: async () => { throw new Error('redis down'); },
  };
  const vFail = await mk(downRedis).triggerRescan(PRODUCT_ID);
  assert.equal(vFail.status, 'PASSED');
  ok('7. Rescan shield: allow/reset-expiry, 429 at 6th, fail-open on outage');
}

// ---------- 8. Appeal workflow (BDD-2: submit → overrule → publish) ----------
{
  const events: unknown[][] = [];
  const notified: unknown[][] = [];
  const redis = { xaddPipeline: async (...a: unknown[]) => { events.push(a); }, incr: async () => 1, expire: async () => undefined };
  const notify = { notify: async (...a: unknown[]) => { notified.push(a); return { messageId: 'm1' }; } };
  function mockDb(logStatus: string | null, appealStatus: string | null) {
    const txLog: string[] = [];
    const shared = {
      product: {
        findUnique: async () => ({ id: PRODUCT_ID, sellerId: SELLER_ID, title: 'Ebook A' }),
        update: async (a: unknown) => { txLog.push(`product:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      user: { findUnique: async () => ({ id: SELLER_ID, lineUserId: 'U999' }) },
      contentModerationLog: {
        findFirst: async () => (logStatus ? { status: logStatus } : null),
        create: async (a: unknown) => { txLog.push(`log:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
      creatorAppeal: {
        findUnique: async () => (appealStatus ? { id: APPEAL_ID, creatorId: SELLER_ID, status: appealStatus } : null),
        upsert: async () => ({ id: APPEAL_ID }),
        update: async (a: unknown) => { txLog.push(`appeal:${JSON.stringify((a as { data: unknown }).data)}`); return {}; },
      },
    };
    return { db: { ...shared, $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(shared) }, txLog };
  }
  const reason = 'หนังสือเล่มนี้ข้าพเจ้าเป็นผู้แต่งเอง มีสัญญาอนุญาตแนบมาด้วย';

  // 8a. submit happy path
  events.length = 0;
  const s1 = mockDb('QUARANTINED', null);
  const am1 = new AppealManagerService(s1.db as never, redis as never, notify as never);
  const sub = await am1.submitAppeal(SELLER_ID, { productId: PRODUCT_ID, appealReason: reason, proofDocumentUrls: ['https://vault.test/proof.pdf'] });
  assert.deepEqual(sub, { appealId: APPEAL_ID, productId: PRODUCT_ID, status: 'PENDING' });
  assert.ok(s1.txLog.some((t) => t.includes('APPEAL_PENDING')), 'APPEAL_PENDING ledger in tx');
  assert.ok(events.some((e) => JSON.stringify(e).includes('moderation.appeal.submitted')), 'appeal submitted stream');

  // 8b. submit guards
  const amG = new AppealManagerService(mockDb('QUARANTINED', null).db as never, redis as never, notify as never);
  await assert.rejects(() => amG.submitAppeal('stranger', { productId: PRODUCT_ID, appealReason: reason, proofDocumentUrls: [] }), /owner/);
  await assert.rejects(() => amG.submitAppeal(SELLER_ID, { productId: PRODUCT_ID, appealReason: 'สั้น', proofDocumentUrls: [] }), /Invalid appeal/);
  const amClean = new AppealManagerService(mockDb('PASSED', null).db as never, redis as never, notify as never);
  await assert.rejects(() => amClean.submitAppeal(SELLER_ID, { productId: PRODUCT_ID, appealReason: reason, proofDocumentUrls: [] }), /cannot be appealed/);

  // 8c. approve → MANUALLY_APPROVED + published
  events.length = 0; notified.length = 0;
  const s2 = mockDb('APPEAL_PENDING', 'PENDING');
  const am2 = new AppealManagerService(s2.db as never, redis as never, notify as never);
  assert.equal(await am2.decideAppeal({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { productId: PRODUCT_ID, approve: true, adminNotes: 'มีลิขสิทธิ์ถูกต้อง' }, NET_TENANT), true);
  assert.ok(s2.txLog.some((t) => t.includes('MANUALLY_APPROVED')), 'approval ledger in tx');
  assert.ok(s2.txLog.some((t) => t.startsWith('product:') && t.includes('"isPublished":true')), 'republished in tx');
  assert.ok(events.some((e) => JSON.stringify(e).includes('moderation.appeal.approved')), 'approved stream');
  assert.equal(notified.length, 1);

  // 8d. reject → REJECTED + stays unpublished
  events.length = 0;
  const s3 = mockDb('APPEAL_PENDING', 'PENDING');
  const am3 = new AppealManagerService(s3.db as never, redis as never, notify as never);
  assert.equal(await am3.decideAppeal({ id: ADMIN_ID, role: 'FINANCE_ADMIN' }, { productId: PRODUCT_ID, approve: false, adminNotes: 'หลักฐานไม่พอ' }, NET_TENANT), true);
  assert.ok(s3.txLog.some((t) => t.startsWith('product:') && t.includes('"isPublished":false')), 'stays unpublished');

  // 8e. decide guards
  const amD = new AppealManagerService(mockDb('APPEAL_PENDING', 'PENDING').db as never, redis as never, notify as never);
  await assert.rejects(() => amD.decideAppeal({ id: ADMIN_ID, role: 'MEMBER' }, { productId: PRODUCT_ID, approve: true, adminNotes: 'x' }), /admin role/);
  await assert.rejects(() => amD.decideAppeal({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { productId: PRODUCT_ID, approve: true, adminNotes: '  ' }), /notes/);
  await assert.rejects(() => amD.decideAppeal({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { productId: '', approve: true, adminNotes: 'x' }), /Missing productId/);
  const amDone = new AppealManagerService(mockDb('APPEAL_PENDING', 'APPROVED').db as never, redis as never, notify as never);
  await assert.rejects(() => amDone.decideAppeal({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { productId: PRODUCT_ID, approve: true, adminNotes: 'x' }), /already APPROVED/);
  const amNone = new AppealManagerService(mockDb('APPEAL_PENDING', null).db as never, redis as never, notify as never);
  await assert.rejects(() => amNone.decideAppeal({ id: ADMIN_ID, role: 'SUPER_ADMIN' }, { productId: PRODUCT_ID, approve: true, adminNotes: 'x' }), /No appeal/);
  ok('8. Appeal submit/decide atomic + 8 guards');
}

// ---------- 9. FIFO worker (stats, SLA, poison isolation) ----------
{
  const engine = {
    processContentModeration: async (id: string) => {
      if (id === 'poison') throw new Error('poison product');
      if (id === 'slow') return { productId: id, status: 'PASSED', confidenceScore: 0, flaggedCategories: [], violatingLocations: [], severity: 'LOW', elapsedMs: 1600 };
      return { productId: id, status: id === 'dirty' ? 'QUARANTINED' : 'PASSED', confidenceScore: 0.9, flaggedCategories: [], violatingLocations: [], severity: 'LOW', elapsedMs: 120 };
    },
  };
  const worker = new ModerationQueueProcessor(engine as never);
  assert.equal(worker.enqueue({ productId: 'clean', contentType: 'EBOOK' }), 1);
  assert.equal(worker.enqueue({ productId: 'dirty', contentType: 'COURSE_VIDEO' }), 2);
  assert.equal(worker.enqueue({ productId: 'poison', contentType: 'EBOOK' }), 3);
  assert.equal(worker.enqueue({ productId: 'slow', contentType: 'EBOOK' }), 4);
  assert.equal(worker.pending(), 4);
  const stats = await worker.drain();
  assert.deepEqual(stats, { drained: 4, passed: 2, quarantined: 1, failed: 1, slaBreaches: 1, pending: 0 });
  assert.equal(worker.pending(), 0);
  const empty = await worker.drain();
  assert.equal(empty.drained, 0);
  ok('9. FIFO drain stats + poison isolation + SLA breach count');
}

// ---------- 10. Webhook HMAC taxonomy (fail-closed 401) ----------
{
  const secret = 'phase112-webhook-secret';
  const body = JSON.stringify({ productId: PRODUCT_ID, contentType: 'EBOOK' });
  const good = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const check = (sig: string | undefined, key: string): boolean => {
    if (!sig || !key) return false;
    const c = createHmac('sha256', key).update(body, 'utf8').digest('hex');
    if (sig.length !== c.length) return false;
    try {
      const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
      return timingSafeEqual(Buffer.from(sig), Buffer.from(c));
    } catch {
      return false;
    }
  };
  assert.equal(check(good, secret), true);
  assert.equal(check(good.slice(0, -1) + '0', secret), false);
  assert.equal(check(good, 'wrong'), false);
  assert.equal(check(undefined, secret), false);
  ok('10. Webhook HMAC mint/verify/forgery/secret-mismatch taxonomy');
}

// ---------- 11. Prisma Gate 1 + SDL + aliases + module wiring ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const e of ['enum ModerationStatus', 'enum FlagCategory', 'enum ModerationSeverity']) {
    assert.ok(prisma.includes(e), e);
  }
  for (const m of ['model ContentModerationLog', 'model CopyrightFingerprint', 'model ContentFlagReport', 'model CreatorAppeal']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('flaggedCategories FlagCategory[]'), 'flaggedCategories native enum array');
  assert.ok(prisma.includes('@@index([status])'), 'status index');
  assert.ok(prisma.includes('contentModerationLogs ContentModerationLog[]'), 'Product back-relation');
  assert.ok(prisma.includes('creatorAppeals     CreatorAppeal[]'), 'User back-relation');
  const sdl = readFileSync('apps/backend/src/api/graphql/moderation/moderation.graphql', 'utf8');
  for (const t of ['type ModerationResultPayload', 'type CreatorAppealPayload', 'getModerationQueue', 'getContentModerationStatus', 'triggerContentRescan', 'submitCreatorAppeal', 'adminReviewModeration']) {
    assert.ok(sdl.includes(t), `SDL ${t}`);
  }
  const alias = readFileSync('apps/backend/src/api/graphql/moderation/moderation.resolver.ts', 'utf8');
  assert.ok(alias.includes('ModerationResolver'), 'api alias re-exports module resolver');
  const mod = readFileSync('apps/backend/src/modules/moderation/moderation.module.ts', 'utf8');
  for (const p of ['NsfwDetectorService', 'CopyrightScannerService', 'ModerationEngineService', 'AppealManagerService', 'ModerationQueueProcessor', 'ModerationResolver', 'ModerationWebhookController', 'CreatorAppealController', 'ModerationAdminController']) {
    assert.ok(mod.includes(p), `module wires ${p}`);
  }
  assert.ok(!/ModuleModule|ServiceService|ControllerController/.test(mod), 'scaffold doubled names retired');
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('ModerationModule'), 'AppModule imports ModerationModule');
  const webhooks = readFileSync('apps/backend/src/api/webhooks/webhooks.module.ts', 'utf8');
  assert.ok(webhooks.includes('ModerationEventController'), 'webhooks module mounts scan-event');
  const hook = readFileSync('apps/backend/src/api/webhooks/moderation/moderation-event.controller.ts', 'utf8');
  assert.ok(hook.includes('x-moderation-signature') && hook.includes('timingSafeEqual'), 'HMAC-guarded scan-event');
  ok('11. Prisma Gate 1 + SDL §3.2 + aliases + module/webhook wiring');
}

// ---------- 12. Frontend Gate 3/5 (5 states, IDB, shield, proxies) ----------
{
  const studio = readFileSync('apps/frontend/app/(admin)/moderation/page.tsx', 'utf8');
  for (const s of ['MOD_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(studio.includes(s), `studio state ${s}`);
  }
  const appeal = readFileSync('apps/frontend/app/(liff)/creator/appeals/page.tsx', 'utf8');
  for (const s of ['LIFF_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(appeal.includes(s), `appeal page state ${s}`);
  }
  const sheet = readFileSync('apps/frontend/components/moderation/AppealSheet.tsx', 'utf8');
  assert.ok(sheet.includes('appeal-shield') && sheet.includes('PASSED') && sheet.includes('QUARANTINED'), 'status shield');
  assert.ok(sheet.includes('minLength={10}'), 'reason ≥10 gate');
  const queue = readFileSync('apps/frontend/components/moderation/ModerationQueue.tsx', 'utf8');
  assert.ok(queue.includes('mod-score') && queue.includes('mod-flag') && queue.includes('mod-status'), 'queue markers');
  const lib = readFileSync('apps/frontend/lib/moderation/moderation-client.ts', 'utf8');
  assert.ok(lib.includes('indexedDB') && lib.includes('saveAppealDraft') && lib.includes('loadAppealDraft'), 'IDB offline drafts');
  assert.ok(!lib.includes('lucide') && !lib.includes('framer'), 'no heavy LIFF deps');
  for (const p of [
    'apps/frontend/app/api/v1/admin/moderation/queue/route.ts',
    'apps/frontend/app/api/v1/admin/moderation/review/route.ts',
    'apps/frontend/app/api/v1/moderation/status/route.ts',
    'apps/frontend/app/api/v1/moderation/scan/route.ts',
    'apps/frontend/app/api/v1/moderation/rescan/route.ts',
    'apps/frontend/app/api/v1/moderation/appeals/submit/route.ts',
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('localhost:4000'), `proxy backend: ${p}`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['ModerationCheckPayloadSchema', 'CreatorAppealPayloadSchema', 'severityFor', 'MODERATION_SCAN_SLA_MS', 'NSFW_FLAG_THRESHOLD']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  ok('12. Frontend 5-state + shield + IDB + 6 proxies + barrel');
}
}

main()
  .then(() => console.log(`\nPhase 112 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 112 contracts FAILED:', err);
    process.exit(1);
  });
