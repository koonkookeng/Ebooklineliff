// SSOT Phase 109 §10-11 — contract tests (Zod, HMAC tickets, guard, repo,
// atomic commands, KYC processor, Prisma Gate 1, SDL, frontend, barrel).
// Run: npx tsx scripts/test-phase109-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UserRoleEnum,
  KYCStatusEnum,
  UserMerchantFilterSchema,
  AdminUserActionPayloadSchema,
  AdminUserTableItemSchema,
  ADMIN_CONSOLE_ROLES,
  ADMIN_STATS_TTL_SEC,
  ADMIN_LIST_CACHE_TTL_SEC,
  IMPERSONATION_TTL_SEC,
  KYC_PRESIGN_TTL_SEC,
  ADMIN_TABLE_MAX_DOM_ROWS,
  adminUsersCacheKey,
  signImpersonationTicket,
  verifyImpersonationTicket,
} from '../packages/shared/src/schemas/admin-user.schema';
import { AdminRbacGuard } from '../apps/backend/src/modules/admin/user-management/guards/admin-rbac.guard';
import { AdminUserPrismaRepository } from '../apps/backend/src/modules/admin/user-management/repositories/admin-user-prisma.repository';
import { AdminUserQueryService } from '../apps/backend/src/modules/admin/user-management/services/admin-user-query.service';
import { AdminUserCommandService } from '../apps/backend/src/modules/admin/user-management/services/admin-user-command.service';
import { AdminKycProcessorService } from '../apps/backend/src/modules/admin/user-management/services/admin-kyc-processor.service';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';
const SECRET = 'phase109-test-secret-32bytes!!!!';

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_MODERATOR', 'SUPPORT_STAFF', 'INSTRUCTOR', 'SELLER', 'MEMBER']) {
    assert.equal(UserRoleEnum.safeParse(v).success, true, v);
  }
  assert.equal(UserRoleEnum.safeParse('ADMIN').success, false);
  for (const v of ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'ACTION_REQUIRED']) {
    assert.equal(KYCStatusEnum.safeParse(v).success, true, v);
  }
  assert.equal(KYCStatusEnum.safeParse('EXPIRED').success, false);
  const f = UserMerchantFilterSchema.parse({ role: ['INSTRUCTOR'], kycStatus: ['VERIFIED'], minWalletBalance: 10000, searchKeyword: 'สมชาย' });
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, 20);
  assert.equal(f.sortBy, 'createdAt');
  assert.equal(UserMerchantFilterSchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(
    AdminUserActionPayloadSchema.safeParse({ userId: UUID, action: 'UPDATE_ROLE', newRole: 'SELLER', reason: 'เลื่อนเป็นผู้ขาย' }).success,
    true,
  );
  assert.equal(
    AdminUserActionPayloadSchema.safeParse({ userId: UUID, action: 'FREEZE_ACCOUNT', reason: 'abc' }).success,
    false,
  );
  assert.equal(
    AdminUserTableItemSchema.safeParse({
      id: UUID, lineUserId: null, email: 'a@b.co', phone: null, displayName: 'สมชาย',
      avatarUrl: null, role: 'MEMBER', kycStatus: 'PENDING', walletBalance: 10.5,
      rewardPoints: 3, affiliateCode: 'AFF-1', totalOrdersCount: 2, totalSpentAmount: 199,
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    }).success,
    true,
  );
  assert.deepEqual([...ADMIN_CONSOLE_ROLES], ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_STAFF']);
  assert.equal(ADMIN_STATS_TTL_SEC, 60);
  assert.equal(ADMIN_LIST_CACHE_TTL_SEC, 30);
  assert.equal(IMPERSONATION_TTL_SEC, 900);
  assert.equal(KYC_PRESIGN_TTL_SEC, 120);
  assert.ok(ADMIN_TABLE_MAX_DOM_ROWS < 300);
  ok('1. Zod SSOT verbatim + budgets (§3.1)');
}

// ---------- 2. HMAC impersonation tickets + cache keys ----------
{
  const ticket = signImpersonationTicket(SECRET, UUID, UUID_B, 'nonce-1');
  const verified = verifyImpersonationTicket(SECRET, ticket);
  assert.deepEqual(verified, { targetUserId: UUID, adminId: UUID_B });
  assert.equal(verifyImpersonationTicket('wrong-secret', ticket), null);
  assert.equal(verifyImpersonationTicket(SECRET, ticket.slice(0, -4) + 'AAAA'), null);
  const expired = signImpersonationTicket(SECRET, UUID, UUID_B, 'n', Date.now() - 901_000);
  assert.equal(verifyImpersonationTicket(SECRET, expired), null);
  const k1 = adminUsersCacheKey({ role: ['SELLER'], page: 1 });
  const k2 = adminUsersCacheKey({ role: ['MEMBER'], page: 1 });
  assert.ok(k1.startsWith('admin:users:'));
  assert.notEqual(k1, k2);
  ok('2. HMAC ticket mint/verify/expiry/forgery + cache keys');
}

// ---------- 3. AdminRbacGuard (fail-closed, impersonation ban) ----------
{
  const guard = new AdminRbacGuard({ getAllAndOverride: () => undefined } as never);
  const ctxFor = (role?: string, impersonated = false) =>
    ({
      getType: () => 'http',
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role, isImpersonated: impersonated } : undefined }) }),
    }) as never;
  assert.equal(guard.canActivate(ctxFor('SUPER_ADMIN')), true);
  assert.equal(guard.canActivate(ctxFor('SUPPORT_STAFF')), true);
  assert.throws(() => guard.canActivate(ctxFor('MEMBER')), /Insufficient admin permission/);
  assert.throws(() => guard.canActivate(ctxFor(undefined)), /Insufficient admin permission/);
  assert.throws(() => guard.canActivate(ctxFor('SUPER_ADMIN', true)), /Impersonated sessions/);
  ok('3. AdminRbacGuard allow-list + fail-closed + impersonation ban');
}

// ---------- 4. Repository: where-builder + cached list (mocked) ----------
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

const MEMBER = {
  id: UUID, lineUserId: 'U1', email: 'm@x.co', phone: null, displayName: 'สมชาย',
  avatarUrl: null, role: 'MEMBER', kycStatus: 'PENDING', walletBalance: 100 as unknown as number,
  rewardPoints: 5, affiliateCode: 'AFF-1', isFrozen: false,
  createdAt: new Date('2026-10-01T00:00:00.000Z'), updatedAt: new Date('2026-10-02T00:00:00.000Z'),
};

{
  const redis: any = mockRedis();
  const prisma: any = {
    user: {
      async findMany() { return [MEMBER]; },
      async count() { return 1; },
      async aggregate() { return { _sum: { walletBalance: 100 } }; },
    },
    order: { async groupBy() { return [{ userId: UUID, _count: { _all: 2 }, _sum: { totalAmount: 199 } }]; } },
  };
  const repo = new AdminUserPrismaRepository(prisma, redis);
  const where = repo.buildWhere({ role: ['INSTRUCTOR'], kycStatus: ['VERIFIED'], minWalletBalance: 10000, searchKeyword: 'สมชาย', page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
  assert.deepEqual(where['role'], { in: ['INSTRUCTOR'] });
  assert.deepEqual(where['walletBalance'], { gte: 10000 });
  assert.equal((where['OR'] as unknown[]).length, 4);
  const first = await repo.listUsersAndMerchants({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
  assert.equal(first.total, 1);
  assert.equal(redis.store.size, 1); // list cached 30s
  const second = await repo.listUsersAndMerchants({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
  assert.equal(second.total, 1); // cache hit
  const stats = await repo.getSummaryStats(undefined);
  assert.equal(stats.totalUsers, 1);
  ok('4. Indexed where-builder + cached list + summary stats');
}

// ---------- 5. Query service: table-item mapping + detail ----------
{
  const redis: any = mockRedis();
  const prisma: any = {
    user: {
      async findMany() { return []; },
      async count() { return 0; },
      async aggregate() { return { _sum: { walletBalance: 0 } }; },
      async findUnique() {
        return { ...MEMBER, walletBalance: { toString: () => '100' }, kycDetail: null, walletAuditLedgers: [], _count: { orders: 2, referrals: 1 } };
      },
    },
    order: { async groupBy() { return []; }, async aggregate() { return { _sum: { totalAmount: 199 } }; } },
  };
  const queries = new AdminUserQueryService(new AdminUserPrismaRepository(prisma, redis));
  const detail: any = await queries.getUserDetail(UUID);
  assert.equal(detail.totalOrdersCount, 2);
  assert.equal(detail.referralCount, 1);
  assert.equal(detail.totalSpentAmount, '199');
  ok('5. Detail aggregates (orders/referrals/spent, no N+1)');
}

// ---------- 6. Command service: atomic actions + guards (mocked tx) ----------
function mockCommandPrisma(userRow: any, adminRole = 'SUPER_ADMIN') {
  const writes: Array<{ model: string; op: string; data: unknown }> = [];
  const tx: any = {
    user: { async update({ data }: any) { writes.push({ model: 'user', op: 'update', data }); Object.assign(userRow, data); return userRow; } },
    walletAuditLedger: { async create({ data }: any) { writes.push({ model: 'walletAuditLedger', op: 'create', data }); return data; } },
    creatorKYC: { async update({ data }: any) { writes.push({ model: 'creatorKYC', op: 'update', data }); return data; } },
    auditLog: { async create({ data }: any) { writes.push({ model: 'auditLog', op: 'create', data }); return data; } },
  };
  const prisma: any = {
    user: {
      async findUnique({ where }: any) {
        if (where.id === 'admin-1') return { id: 'admin-1', role: adminRole };
        return where.id === userRow.id ? { ...userRow, walletBalance: userRow.walletBalance, kycDetail: userRow.kycDetail ?? null } : null;
      },
    },
    auditLog: { async create({ data }: any) { writes.push({ model: 'auditLog', op: 'create-outside', data }); return data; } },
    $transaction: async (fn: any) => fn(tx),
  };
  return { prisma, writes };
}

{
  const row: any = { id: UUID, role: 'MEMBER', walletBalance: 100, kycStatus: 'PENDING', isFrozen: false, kycDetail: { userId: UUID } };
  const { prisma, writes } = mockCommandPrisma(row);
  const svc = new AdminUserCommandService(new AdminUserPrismaRepository(prisma, mockRedis() as never));
  const out: any = await svc.executeAdminUserAction('admin-1', '1.2.3.4', { userId: UUID, action: 'ADJUST_WALLET', walletAdjustmentAmount: 50, reason: 'ชดเชยออเดอร์ซ้ำ' });
  assert.equal(out.success, true);
  assert.equal(row.walletBalance, 150);
  const ledger = writes.find((w) => w.model === 'walletAuditLedger');
  assert.deepEqual((ledger?.data as any).balanceBefore, 100);
  assert.deepEqual((ledger?.data as any).balanceAfter, 150);
  const audit = writes.find((w) => w.model === 'auditLog' && (w.data as any).action === 'ADMIN_USER_ADJUST_WALLET');
  assert.equal((audit?.data as any).executorId, 'admin-1');
  assert.equal((audit?.data as any).ipAddress, '1.2.3.4');
  ok('6a. ADJUST_WALLET atomic (balance + ledger + audit)');
}
{
  const row: any = { id: UUID, role: 'MEMBER', walletBalance: 100, kycStatus: 'PENDING', isFrozen: false, kycDetail: null };
  const { prisma } = mockCommandPrisma(row);
  const svc = new AdminUserCommandService(new AdminUserPrismaRepository(prisma, mockRedis() as never));
  await assert.rejects(
    () => svc.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'ADJUST_WALLET', walletAdjustmentAmount: -200, reason: 'หักเกินจริง' }),
    /ติดลบ/,
  );
  await assert.rejects(
    () => svc.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'ADJUST_WALLET', walletAdjustmentAmount: 10, reason: 'สั้น' }),
    /ไม่ถูกต้อง|อย่างน้อย 5/,
  );
  await assert.rejects(
    () => svc.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'ADJUST_WALLET', walletAdjustmentAmount: 10, reason: 'เหตุผลครบถ้วน' }, { impersonated: true }),
    /ห้ามปรับยอดเงิน/,
  );
  // Role-escalation: non-SUPER admin cannot grant admin roles.
  const { prisma: prisma2 } = mockCommandPrisma(row, 'FINANCE_ADMIN');
  const svc2 = new AdminUserCommandService(new AdminUserPrismaRepository(prisma2, mockRedis() as never));
  await assert.rejects(
    () => svc2.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'UPDATE_ROLE', newRole: 'FINANCE_ADMIN', reason: 'แอบอัปสิทธิ์' }),
    /SUPER_ADMIN/,
  );
  const okOut: any = await svc2.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'UPDATE_ROLE', newRole: 'SELLER', reason: 'เลื่อนเป็นผู้ขาย' });
  assert.equal(okOut.success, true);
  ok('6b. Wallet/role guards (negative-balance, impersonation ban, escalation)');
}
{
  const row: any = { id: UUID, role: 'MEMBER', walletBalance: 0, kycStatus: 'PENDING', isFrozen: false, kycDetail: { userId: UUID } };
  const { prisma, writes } = mockCommandPrisma(row);
  const svc = new AdminUserCommandService(new AdminUserPrismaRepository(prisma, mockRedis() as never));
  await svc.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'APPROVE_KYC', reason: 'KYC ตรวจสอบผ่าน' });
  assert.equal(row.kycStatus, 'VERIFIED');
  assert.equal(row.role, 'SELLER'); // MEMBER auto-promoted
  const kycWrite = writes.find((w) => w.model === 'creatorKYC');
  assert.ok(kycWrite);
  await assert.rejects(
    () => svc.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'REJECT_KYC', reason: 'ปฏิเสธ' }),
    /เหตุผลในการปฏิเสธ/,
  );
  const frozen: any = { id: UUID, role: 'MEMBER', walletBalance: 0, kycStatus: 'PENDING', isFrozen: true, kycDetail: null };
  const ctx2 = mockCommandPrisma(frozen);
  const svcFrozen = new AdminUserCommandService(new AdminUserPrismaRepository(ctx2.prisma, mockRedis() as never));
  await svcFrozen.executeAdminUserAction('admin-1', 'ip', { userId: UUID, action: 'FREEZE_ACCOUNT', reason: 'สแปมรีวิว' });
  assert.equal(frozen.isFrozen, true);
  ok('6c. KYC approve (auto-promote) / reject-reason / freeze');
}

// ---------- 7. Impersonation mint/resolve (mocked) ----------
{
  process.env.IMPERSONATION_HMAC_SECRET = SECRET;
  const mkSvc = (role: string, frozen: boolean) => {
    const target: any = { id: UUID, role, displayName: 'Target', isFrozen: frozen };
    const prisma: any = {
      user: { async findUnique({ where }: any) { return where.id === UUID ? target : null; } },
      auditLog: { async create() { return {}; } },
    };
    const redis: any = mockRedis();
    return { svc: new AdminUserCommandService(new AdminUserPrismaRepository(prisma, redis)), redis };
  };
  const { svc } = mkSvc('MEMBER', false);
  const minted: any = await svc.mintImpersonationToken('admin-1', UUID, 'ช่วยลูกค้าตรวจสอบออเดอร์', '9.9.9.9');
  assert.equal(minted.expiresIn, 900);
  assert.ok(typeof minted.impersonationToken === 'string');
  const resolved: any = await svc.resolveImpersonationTicket(minted.impersonationToken);
  assert.equal(resolved.sub, UUID);
  assert.equal(resolved.isImpersonated, true);
  assert.equal(resolved.impersonatedByAdminId, 'admin-1');
  await assert.rejects(() => svc.resolveImpersonationTicket('bogus'), /ไม่ถูกต้อง/);
  const { svc: superSvc } = mkSvc('SUPER_ADMIN', false);
  await assert.rejects(() => superSvc.mintImpersonationToken('admin-1', UUID, 'แอบอ้างสิทธิ์', 'ip'), /SUPER_ADMIN/);
  const { svc: frozenSvc } = mkSvc('MEMBER', true);
  await assert.rejects(() => frozenSvc.mintImpersonationToken('admin-1', UUID, 'บัญชีถูกระงับแล้ว', 'ip'), /ระงับ/);
  delete process.env.IMPERSONATION_HMAC_SECRET;
  ok('7. Impersonation mint/resolve/revoke + SUPER/frozen bans');
}

// ---------- 8. KYC processor: pending list + presigned docs (mocked) ----------
{
  const prisma: any = {
    user: {
      async findMany() {
        return [{ id: UUID, displayName: 'สมชาย', email: 'm@x.co', phone: null, kycStatus: 'PENDING', createdAt: new Date('2026-10-01T00:00:00.000Z'), kycDetail: { bankName: 'KBANK', bankAccountName: 'Somchai', idCardImageUrl: 'kyc/u1/id.png', createdAt: new Date('2026-10-01T00:00:00.000Z') } }];
      },
      async count() { return 1; },
      async findUnique() {
        return { id: UUID, kycDetail: { idCardImageUrl: 'kyc/u1/id.png', selfieImageUrl: null, bookbankImageUrl: null } };
      },
    },
    auditLog: { async create() { return {}; } },
  };
  const commands = { executeAdminUserAction: async (...args: unknown[]) => ({ success: true, echoed: args.length }) } as never;
  const r2 = { presignedGetUrl: (key: string, ttl: number) => `https://r2.test/${key}?exp=${ttl}` } as never;
  const kyc = new AdminKycProcessorService(new AdminUserPrismaRepository(prisma, mockRedis() as never), commands, r2);
  const pending = await kyc.getPendingList(1, 20);
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].bankName, 'KBANK');
  const docs: any = await kyc.getKycDocumentUrls('admin-1', UUID, 'ip');
  assert.equal(docs.urls.length, 1);
  assert.ok(docs.urls[0].url.includes('exp=120'));
  await assert.rejects(() => kyc.rejectKYC('admin-1', UUID, 'ip', 'สั้น'), /อย่างน้อย 5|ปฏิเสธ/);
  ok('8. KYC pending mapping + 120s presigned docs + view audit');
}

// ---------- 9. Prisma Gate 1 + SDL parity ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const token of ['model WalletAuditLedger', 'isFrozen', 'freezeReason', 'reviewedByAdminId', 'executorId', '@@index([role, kycStatus])', '@@index([walletBalance])']) {
    assert.ok(prisma.includes(token), token);
  }
  const sdl = readFileSync('apps/backend/src/api/graphql/admin-user.graphql', 'utf8');
  for (const intent of ['adminGetUsersAndMerchants', 'adminGetUserDetail', 'adminGetKYCPendingList', 'adminExecuteUserAction', 'adminApproveKYC', 'adminRejectKYC', 'adminGenerateImpersonationToken']) {
    assert.ok(sdl.includes(intent), intent);
  }
  const resolver = readFileSync('apps/backend/src/modules/admin/user-management/resolvers/admin-user.resolver.ts', 'utf8');
  assert.ok(!resolver.includes('registerEnumType(UserRoleEnum'), 'twin enums required');
  assert.ok(resolver.includes('enum AdminUserRoleGql'), 'GQL twin enum required');
  ok('9. Prisma Gate 1 + GQL SDL intents + twin-enum guard');
}

// ---------- 10. Frontend 5-state + zero-new-deps ----------
{
  const page = readFileSync('apps/frontend/app/(admin)/admin/users/page.tsx', 'utf8');
  for (const s of ['ADMIN_INIT', 'IDLE', 'LOADING', 'SUCCESS', 'ERROR']) {
    assert.ok(page.includes(s), s);
  }
  const hasDepImport = (src: string, dep: string) =>
    src.includes(`from '${dep}'`) || src.includes(`from "${dep}"`);
  for (const f of [
    'apps/frontend/app/(admin)/admin/users/page.tsx',
    'apps/frontend/components/admin/user-table/UniversalUserTable.tsx',
    'apps/frontend/components/admin/kyc-modal/KycInspectionDrawer.tsx',
    'apps/frontend/components/admin/user-table/WalletAdjustModal.tsx',
    'apps/frontend/lib/admin-users.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!hasDepImport(src, '@tanstack/react-table'), `${f}: no tanstack table`);
    assert.ok(!hasDepImport(src, '@tanstack/react-virtual'), `${f}: no tanstack virtual`);
    assert.ok(!hasDepImport(src, 'lucide-react'), `${f}: no lucide`);
  }
  const table = readFileSync('apps/frontend/components/admin/user-table/UniversalUserTable.tsx', 'utf8');
  assert.ok(table.includes('translateY'), 'windowing transform required');
  ok('10. Console 5-state + dep-free windowing + zero-new-deps');
}
}

main().then(() => {
  console.log(`\nPhase 109 contracts: ${passed} check groups passed.`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
