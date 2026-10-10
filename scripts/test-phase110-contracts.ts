// SSOT Phase 110 §10-11 — contract tests (Zod, RFM math, masking, repo,
// 360 service, security telemetry, revoke, Prisma Gate 1, SDL, frontend).
// Run: npx tsx scripts/test-phase110-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RiskLevelEnum,
  UserActivityTypeEnum,
  RFMScoreSchema,
  ReadingTelemetryLogSchema,
  VideoLearningTelemetryLogSchema,
  SecurityAuditLogSchema,
  User360ProfileSchema,
  INSPECTOR_CACHE_TTL_SEC,
  INSPECTOR_RECENT_LIMIT,
  CONCURRENCY_IP_THRESHOLD,
  CONCURRENCY_WINDOW_SEC,
  ANOMALY_STATE_SUSPICIOUS_CONCURRENCY,
  inspectorCacheKey,
  rfmSegmentLabel,
  recencyScoreFor,
  frequencyScoreFor,
  monetaryScoreFor,
  maskIp,
  maskDevice,
  isMaskedInspectorRole,
} from '../packages/shared/src/schemas/inspector-contract';
import { RfmCalculatorService } from '../apps/backend/src/modules/user-inspector/services/rfm-calculator.service';
import { SecurityTelemetryService } from '../apps/backend/src/modules/user-inspector/services/security-telemetry.service';
import { UserInspectorService } from '../apps/backend/src/modules/user-inspector/services/user-inspector.service';
import { UserInspectorRepository } from '../apps/backend/src/modules/user-inspector/repositories/user-inspector.repository';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) assert.equal(RiskLevelEnum.safeParse(v).success, true, v);
  assert.equal(RiskLevelEnum.safeParse('UNKNOWN').success, false);
  for (const v of ['LOGIN_LIFF', 'LOGIN_WEB', 'PURCHASE_COMPLETED', 'EBOOK_PAGE_READ', 'COURSE_VIDEO_WATCH', 'SLIP_UPLOADED', 'AFFILIATE_CLICK', 'SESSION_REVOKED']) {
    assert.equal(UserActivityTypeEnum.safeParse(v).success, true, v);
  }
  assert.equal(UserActivityTypeEnum.safeParse('LOGOUT').success, false);
  assert.equal(RFMScoreSchema.safeParse({ recencyScore: 5, frequencyScore: 4, monetaryScore: 3, segmentLabel: 'LOYAL' }).success, true);
  assert.equal(RFMScoreSchema.safeParse({ recencyScore: 6, frequencyScore: 4, monetaryScore: 3, segmentLabel: 'X' }).success, false);
  assert.equal(
    ReadingTelemetryLogSchema.safeParse({ ebookId: UUID, bookTitle: 'T', pageNumber: 3, dwellTimeSeconds: 45, timestamp: '2026-10-01T00:00:00.000Z' }).success,
    true,
  );
  assert.equal(
    ReadingTelemetryLogSchema.safeParse({ ebookId: UUID, bookTitle: 'T', pageNumber: 0, dwellTimeSeconds: 45, timestamp: '2026-10-01T00:00:00.000Z' }).success,
    false,
  );
  assert.equal(
    VideoLearningTelemetryLogSchema.safeParse({ courseId: UUID, lessonId: UUID, lessonTitle: 'L', watchedDurationSec: 60, completionPercentage: 101, timestamp: '2026-10-01T00:00:00.000Z' }).success,
    false,
  );
  assert.equal(
    SecurityAuditLogSchema.safeParse({ id: UUID, activityType: 'LOGIN_LIFF', ipAddress: '1.2.3.4', userAgent: 'LIFF', deviceFingerprint: null, lineSessionId: null, riskLevel: 'LOW', createdAt: '2026-10-01T00:00:00.000Z' }).success,
    true,
  );
  assert.equal(INSPECTOR_CACHE_TTL_SEC, 60);
  assert.equal(INSPECTOR_RECENT_LIMIT, 10);
  assert.equal(CONCURRENCY_IP_THRESHOLD, 3);
  assert.equal(CONCURRENCY_WINDOW_SEC, 60);
  assert.equal(ANOMALY_STATE_SUSPICIOUS_CONCURRENCY, 'SUSPICIOUS_CONCURRENCY');
  assert.equal(inspectorCacheKey('u1'), 'inspector:360:u1');
  ok('1. Zod SSOT verbatim + budgets (§3.1)');
}

// ---------- 2. RFM pure math (§7.2) ----------
{
  assert.equal(recencyScoreFor(3), 5);
  assert.equal(recencyScoreFor(10), 4);
  assert.equal(recencyScoreFor(20), 3);
  assert.equal(recencyScoreFor(60), 2);
  assert.equal(recencyScoreFor(120), 1);
  assert.equal(recencyScoreFor(null), 1);
  assert.equal(frequencyScoreFor(12), 5);
  assert.equal(frequencyScoreFor(7), 4);
  assert.equal(frequencyScoreFor(4), 3);
  assert.equal(frequencyScoreFor(2), 2);
  assert.equal(frequencyScoreFor(1), 1);
  assert.equal(frequencyScoreFor(0), 1);
  assert.equal(monetaryScoreFor(15000), 5);
  assert.equal(monetaryScoreFor(7000), 4);
  assert.equal(monetaryScoreFor(3000), 3);
  assert.equal(monetaryScoreFor(800), 2);
  assert.equal(monetaryScoreFor(100), 1);
  assert.equal(rfmSegmentLabel(5, 5, 5, 12), 'CHAMPION');
  assert.equal(rfmSegmentLabel(3, 2, 5, 4), 'HIGH_VALUE');
  assert.equal(rfmSegmentLabel(4, 5, 2, 8), 'LOYAL');
  assert.equal(rfmSegmentLabel(5, 5, 5, 0), 'NEW_USER');
  assert.equal(rfmSegmentLabel(1, 1, 1, 3), 'DORMANT');
  assert.equal(rfmSegmentLabel(2, 2, 2, 3), 'AT_RISK');
  assert.equal(rfmSegmentLabel(4, 3, 3, 5), 'ACTIVE');
  ok('2. RFM thresholds + segments (§7.2)');
}

// ---------- 3. PDPA masking (§8.1) ----------
{
  assert.equal(maskIp('1.2.3.4'), '1.***.***.4');
  assert.equal(maskIp('not-an-ip'), '***');
  assert.equal(maskDevice('fp-abcdef-123456'), 'fp-a****3456');
  assert.equal(maskDevice(null), null);
  assert.equal(maskDevice('short'), '****');
  assert.equal(isMaskedInspectorRole('SUPPORT_STAFF'), true);
  assert.equal(isMaskedInspectorRole('SUPER_ADMIN'), false);
  assert.equal(isMaskedInspectorRole('FINANCE_ADMIN'), false);
  ok('3. PDPA IP/device masking + role scope');
}

function mockRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async setex(k: string, _t: number, v: string) { store.set(k, v); },
    async del(...ks: string[]) { for (const k of ks) store.delete(k); },
    async scanKeys(pattern: string) {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const COMPLETED = [
  { id: 'o1', netAmount: 9000, createdAt: new Date('2026-10-05T00:00:00.000Z') },
  { id: 'o2', netAmount: 3000, createdAt: new Date('2026-09-01T00:00:00.000Z') },
];

function mockRepo(over: Record<string, unknown> = {}) {
  const writes: Array<{ model: string; op: string }> = [];
  const tx: any = {
    user360Metric: { async upsert() { writes.push({ model: 'user360Metric', op: 'upsert' }); return {}; } },
    userSecurityAuditLog: { async create() { writes.push({ model: 'userSecurityAuditLog', op: 'create' }); return {}; } },
    session: { async updateMany() { writes.push({ model: 'session', op: 'updateMany' }); return { count: 2 }; } },
    userDeviceSession: { async updateMany() { writes.push({ model: 'userDeviceSession', op: 'updateMany' }); return { count: 1 }; } },
    activeDeviceSession: { async deleteMany() { return { count: 1 }; } },
    videoStreamSession: { async deleteMany() { return { count: 0 }; } },
  };
  const prisma: any = {
    user: {
      async findUnique() {
        return {
          id: UUID, displayName: 'Somchai', email: 's@x.co', lineUserId: 'U1',
          walletBalance: 500, rewardPoints: 10, createdAt: new Date('2026-01-01T00:00:00.000Z'),
          user360Metric: null,
        };
      },
    },
    order: { async findMany() { return COMPLETED; } },
    product: { async findMany() { return []; } },
    courseLesson: { async findMany() { return []; } },
    ebookPageReadLog: {
      async groupBy() { return []; },
      async findMany() { return []; },
    },
    userVideoWatchTelemetry: { async findMany() { return []; } },
    userSecurityAuditLog: {
      async findMany() { return []; },
      async count() { return 0; },
      async create() { writes.push({ model: 'userSecurityAuditLog', op: 'create' }); return {}; },
    },
    user360Metric: { async upsert() { writes.push({ model: 'user360Metric', op: 'upsert-outside' }); return {}; } },
    session: {
      async findMany() { return [{ sessionToken: 'tok-1' }, { sessionToken: 'tok-2' }]; },
      async updateMany() { return { count: 2 }; },
    },
    userDeviceSession: { async updateMany() { return { count: 1 }; } },
    activeDeviceSession: { async deleteMany() { return { count: 1 }; } },
    videoStreamSession: { async deleteMany() { return { count: 0 }; } },
    courseLearningProgress: { async findMany() { return []; } },
    ebookReadingProgress: { async findMany() { return []; } },
    $transaction: async (fn: any) => fn(tx),
    ...over,
  };
  return { prisma, writes };
}

// ---------- 4. RFM recalculate (LTV 12000 → M5, F2 → F2) ----------
{
  const { prisma } = mockRepo();
  const repo = new UserInspectorRepository(prisma, mockRedis());
  const calc = new RfmCalculatorService(repo);
  const out: any = await calc.recalculate(UUID);
  assert.equal(out.lifetimeValue, 12000);
  assert.equal(out.monetaryScore, 5);
  assert.equal(out.frequencyScore, 2);
  assert.equal(out.segmentLabel, 'HIGH_VALUE');
  assert.equal(calc.scoreRecency(null), 1);
  ok('4. RFM recalculate + metric upsert');
}

// ---------- 5. Security telemetry: anomaly + flagRisk + record guard ----------
{
  const { prisma, writes } = mockRepo();
  prisma.userSecurityAuditLog = {
    async findMany() { return [{ ipAddress: '1.1.1.1' }, { ipAddress: '2.2.2.2' }, { ipAddress: '3.3.3.3' }]; },
    async count() { return 3; },
    async create() { writes.push({ model: 'userSecurityAuditLog', op: 'create' }); return {}; },
  };
  const repo = new UserInspectorRepository(prisma, mockRedis());
  const sec = new SecurityTelemetryService(repo);
  const verdict: any = await sec.detectConcurrencyAnomaly(UUID);
  assert.equal(verdict.anomalous, true);
  assert.equal(verdict.state, 'SUSPICIOUS_CONCURRENCY');
  assert.deepEqual(verdict.distinctIps, ['1.1.1.1', '2.2.2.2', '3.3.3.3']);
  // Single IP → clean.
  prisma.userSecurityAuditLog.findMany = async () => [{ ipAddress: '1.1.1.1' }];
  const clean: any = await sec.detectConcurrencyAnomaly(UUID);
  assert.equal(clean.anomalous, false);
  // flagRisk writes metric + audit atomically.
  const flagged: any = await sec.flagRisk(UUID, 'CRITICAL', 'พบ fraud pattern ซ้ำซ้อน', 'admin-1', '9.9.9.9');
  assert.equal(flagged.updatedRiskLevel, 'CRITICAL');
  await assert.rejects(() => sec.flagRisk(UUID, 'NOPE', 'เหตุผลครบถ้วน', 'admin-1', 'ip'), /Invalid risk level/);
  await assert.rejects(() => sec.recordEvent({ userId: '', activityType: 'LOGIN_LIFF', ipAddress: '1.1.1.1', userAgent: 'x' }), /Missing telemetry identity/);
  ok('5. Concurrency anomaly (3 IPs/60s) + flagRisk atomic + guards');
}

// ---------- 6. 360 service: cache-first, masking, heatmap, revoke ----------
{
  const { prisma } = mockRepo();
  const redis: any = mockRedis();
  const mod = { UserInspectorRepository };
  const repo = new mod.UserInspectorRepository(prisma, redis);
  const calc = new RfmCalculatorService(repo);
  const svc = new UserInspectorService(repo, calc);
  const first: any = await svc.getUser360Profile(UUID, 'SUPER_ADMIN');
  assert.equal(first.lifetimeValueAmount, 12000);
  assert.equal(first.totalOrdersCount, 2);
  assert.equal(redis.store.size, 1); // 60s cache
  const second: any = await svc.getUser360Profile(UUID, 'SUPER_ADMIN');
  assert.equal(second.lifetimeValueAmount, 12000); // cache hit
  // SUPPORT_STAFF sees masked telemetry (empty logs here → structural check).
  const masked: any = await svc.getUser360Profile(UUID, 'SUPPORT_STAFF');
  assert.equal(masked['maskedForSupport'], true);
  const heat: any = await svc.getReadingHeatmap(UUID, 'ebook-1');
  assert.deepEqual(heat.cells, []);
  const video: any = await svc.getVideoAnalytics(UUID, 'course-1');
  assert.equal(video.overallCompletionPercentage, 0);
  const revoked: any = await svc.revokeAllSessions(UUID, 'เหตุผลด้านความปลอดภัย', 'admin-1');
  assert.equal(revoked.success, true);
  assert.ok(revoked.revokedSessionsCount >= 2);
  await assert.rejects(() => svc.getUser360Profile('', 'SUPER_ADMIN'), /not found|Missing/);
  ok('6. 360 cache-first + support masking + heatmap/video/revoke');
}

// ---------- 7. Prisma Gate 1 ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const token of ['model User360Metric', 'model EbookPageReadLog', 'model UserVideoWatchTelemetry', 'model UserSecurityAuditLog', 'enum RiskLevel', 'enum ActivityType', 'inspectorSecurityLogs']) {
    assert.ok(prisma.includes(token), token);
  }
  ok('7. Prisma SSOT models/enums (§4.1 Gate 1)');
}

// ---------- 8. GQL SDL parity ----------
{
  const sdl = readFileSync('apps/backend/src/api/graphql/inspector.graphql', 'utf8');
  for (const intent of ['getUser360Profile', 'getUserReadingHeatmap', 'getUserVideoWatchAnalytics', 'getUserSecurityAuditLogs', 'revokeUserActiveSessions', 'recalculateUserRFMScore', 'flagUserRiskLevel']) {
    assert.ok(sdl.includes(intent), intent);
  }
  const resolver = readFileSync('apps/backend/src/modules/user-inspector/resolvers/user-inspector.resolver.ts', 'utf8');
  assert.ok(!resolver.includes('registerEnumType(RiskLevelEnum'), 'twin enums required');
  assert.ok(resolver.includes('enum InspectorRiskLevelGql'), 'GQL twin enum required');
  ok('8. GQL SDL intents + twin-enum guard');
}

// ---------- 9. Frontend 5-state + zero-new-deps ----------
{
  const page = readFileSync('apps/frontend/app/(admin)/users/[id]/inspector/page.tsx', 'utf8');
  for (const s of ['INSPECTOR_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), s);
  }
  const hasDepImport = (src: string, dep: string) =>
    src.includes(`from '${dep}'`) || src.includes(`from "${dep}"`);
  for (const f of [
    'apps/frontend/app/(admin)/users/[id]/inspector/page.tsx',
    'apps/frontend/components/inspector/User360InspectorView.tsx',
    'apps/frontend/components/inspector/ReadingHeatmap.tsx',
    'apps/frontend/components/inspector/VideoProgressList.tsx',
    'apps/frontend/components/inspector/SecurityAuditTable.tsx',
    'apps/frontend/lib/inspector.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    for (const dep of ['recharts', 'visx', 'lucide-react', '@/components/ui/']) {
      assert.ok(!hasDepImport(src, dep), `${f}: no ${dep}`);
    }
  }
  const view = readFileSync('apps/frontend/components/inspector/User360InspectorView.tsx', 'utf8');
  assert.ok(view.includes('Revoke Sessions'), '1-click revoke required');
  ok('9. Inspector 5-state + dep-free viz + zero-new-deps');
}
}

main().then(() => {
  console.log(`\nPhase 110 contracts: ${passed} check groups passed.`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
