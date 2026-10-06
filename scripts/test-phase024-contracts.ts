// SSOT Phase 024 §10 — contract tests (dispatcher: Zod, flex, queue, fallback, HMAC, SDL)
// Run: npx tsx scripts/test-phase024-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ServiceMessageTypeEnum,
  ServiceMessageDispatchPayloadSchema,
  ServiceMessageDeliveryStatusSchema,
  DispatchStatusEnum,
} from '../packages/shared/src/schemas/service-message-contract';
import { hashPhone, LineServiceMessageService } from '../apps/backend/src/modules/line-service-message/application/line-service-message.service';
import { FlexBuilderService } from '../apps/backend/src/modules/line-service-message/application/flex-builder.service';
import { guardFlexContainer } from '../apps/backend/src/modules/line-service-message/domain/value-objects/flex-container.vo';
import { MessageDispatcherProcessor } from '../apps/backend/src/modules/line-service-message/infrastructure/processors/message-dispatcher.processor';
import { PermanentLineError, RetryableLineError } from '../apps/backend/src/modules/line-service-message/infrastructure/line-api.client';
import { signDeliveryTicket, verifyDeliveryTicket } from '../apps/backend/src/modules/line-service-message/webhooks/delivery-ticket.util';
import type { PrismaService } from '../apps/backend/src/infra/database/prisma.service';
import type { RedisClusterService } from '../apps/backend/src/infra/redis/redis-cluster.service';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const basePayload = {
  tenantId: 'default', userId: 'user-1', lineUserId: 'U123abc',
  messageType: 'ORDER_CONFIRMATION', parameters: { orderNumber: 'ORD-1', amount: 299 },
} as const;

// ---------- 1. Type enum + payload boundaries (§3.1) ----------
{
  const types = ['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT', 'EBOOK_GRANT_ACCESS', 'COURSE_ENROLLMENT', 'SHIPPING_TRACKING', 'AUTHENTICATION_OTP'];
  for (const t of types) assert.equal(ServiceMessageTypeEnum.safeParse(t).success, true);
  assert.equal(ServiceMessageTypeEnum.safeParse('PROMO_BLAST').success, false);
  assert.equal(ServiceMessageDispatchPayloadSchema.safeParse(basePayload).success, true);
  assert.equal(ServiceMessageDispatchPayloadSchema.safeParse({ ...basePayload, lineUserId: '' }).success, false);
  assert.equal(ServiceMessageDispatchPayloadSchema.safeParse({ ...basePayload, parameters: { nested: {} } }).success, false);
  ok('Type enum rejects promo; payload requires lineUserId + flat params');
}

// ---------- 2. Delivery status zero-cost default (§3.1 Gate 6) ----------
{
  const parsed = ServiceMessageDeliveryStatusSchema.safeParse({ jobId: 'log-1', status: 'QUEUED' });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.costIncurred, 0);
  for (const s of DispatchStatusEnum.options) {
    assert.equal(ServiceMessageDeliveryStatusSchema.safeParse({ jobId: 'j', status: s }).success, true);
  }
  ok('Delivery status defaults cost 0.00; 5 dispatch states valid');
}

// ---------- 3. PII hashing (§8.1 PDPA) ----------
{
  const h1 = hashPhone('0812345678');
  assert.equal(h1, hashPhone('0812345678'));
  assert.equal(h1.length, 64);
  assert.notEqual(h1, hashPhone('0812345679'));
  assert.equal(h1.includes('0812345678'), false);
  ok('Phone SHA-256 deterministic, opaque, collision-sensitive');
}

// ---------- 4. Flex compiler + container guard (§5.2) ----------
{
  const builder = new FlexBuilderService();
  const out = builder.compile(
    { templateJson: { type: 'bubble', body: { text: 'Hi {{name}}' } }, parameters: { name: 'A' } },
    'alt',
  );
  assert.deepEqual(out.flex, { type: 'bubble', body: { text: 'Hi A' } });
  assert.deepEqual(out.oversizedImages, []);
  // Missing param leaves placeholder (preview-safe)
  const partial = builder.compile(
    { templateJson: { type: 'bubble', body: { text: '{{a}}-{{b}}' } }, parameters: { a: 'x' } },
    'alt',
  );
  assert.deepEqual(partial.flex, { type: 'bubble', body: { text: 'x-{{b}}' } });
  assert.throws(() => builder.compile({ templateJson: { type: 'text' }, parameters: {} }, 'alt'));
  const guard = guardFlexContainer({ type: 'carousel' });
  assert.equal(guard.ok, true);
  const bad = guardFlexContainer({ type: 'text', text: 'hi' });
  assert.equal(bad.ok, false);
  const big = guardFlexContainer({ type: 'bubble', hero: { url: 'https://r2.example.com/a.webp?bytes=600000' } });
  assert.deepEqual(big.oversizedImages, ['https://r2.example.com/a.webp?bytes=600000']);
  ok('Flex interpolates, tolerates gaps, guards root + 500KB images');
}

function stubRedis(store: Map<string, string>, published: unknown[]): RedisClusterService {
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _t: number, v: string) => { store.set(k, v); },
    del: async (k: string) => { store.delete(k); },
    publish: async (_s: string, m: string) => { published.push(JSON.parse(m)); },
  } as unknown as RedisClusterService;
}

async function main(): Promise<void> {
// ---------- 5. Dispatch guards: inactive channel, missing template (§5.2) ----------
{
  const store = new Map<string, string>();
  const published: unknown[] = [];
  const prisma = {
    tenantLineConfig: { findUnique: async () => null },
    serviceMessageTemplate: { findUnique: async () => null },
    notificationLog: { create: async () => { throw new Error('must not create'); } },
  } as unknown as PrismaService;
  const svc = new LineServiceMessageService(
    prisma, stubRedis(store, published), new FlexBuilderService(),
    { processLog: async () => undefined } as unknown as MessageDispatcherProcessor,
  );
  await assert.rejects(() => svc.dispatchTransactionalMessage({ ...basePayload }));
  ok('Inactive/missing channel rejected before any write');
}

// ---------- 6. Dispatch happy path: hashed PII, zero cost, stream event ----------
{
  const store = new Map<string, string>();
  const published: Array<Record<string, unknown>> = [];
  const created: Array<{ data: Record<string, unknown> }> = [];
  const driven: string[] = [];
  const prisma = {
    tenantLineConfig: { findUnique: async () => ({ tenantId: 'default', isServiceMsgActive: true }) },
    serviceMessageTemplate: {
      findUnique: async () => ({ id: '123e4567-e89b-12d3-a456-426614174000', isActive: true }),
    },
    notificationLog: { create: async (args: { data: Record<string, unknown> }) => { created.push(args); return { id: 'log-1' }; } },
  } as unknown as PrismaService;
  const svc = new LineServiceMessageService(
    prisma, stubRedis(store, published), new FlexBuilderService(),
    { processLog: async (id: string) => { driven.push(id); } } as unknown as MessageDispatcherProcessor,
  );
  const { jobId } = await svc.dispatchTransactionalMessage({ ...basePayload, fallbackPhone: '0812345678' });
  assert.equal(jobId, 'log-1');
  assert.deepEqual(driven, ['log-1']);
  const data = created[0].data;
  assert.equal(data.status, 'QUEUED');
  assert.equal(data.costAmount, 0);
  const payload = data.payload as Record<string, unknown>;
  assert.equal(payload.fallbackPhone, undefined);
  assert.equal(typeof payload.fallbackPhoneHash, 'string');
  assert.equal(published[0].event, 'line.service-message.queued');
  ok('Happy path: PII hashed, cost 0, queued event + inline drive');
}

// ---------- 7. Processor: success, permanent, circuit, idempotent (§1.3/§10) ----------
{
  const mkPrisma = (over: Record<string, unknown>) =>
    ({
      notificationLog: {
        findUnique: async () => ({ id: 'log-1', tenantId: 'default', lineUserId: 'U1', templateId: 't1', status: 'QUEUED', retryCount: 0, payload: { a: 1 } }),
        update: async (args: unknown) => args,
        ...(over.log ?? {}),
      },
      serviceMessageTemplate: { findUnique: async () => ({ id: 't1', templateName: 'T', flexTemplateJson: { type: 'bubble', body: { text: 'ok' } } }) },
      tenantLineConfig: { findUnique: async () => ({ tenantId: 'default', lineChannelAccessToken: 'tok' }) },
      ...over,
    }) as unknown as PrismaService;

  // 7a. success → DELIVERED + circuit closed
  {
    const store = new Map([['circuit:service-message:default', '2']]);
    const published: unknown[] = [];
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const prisma = mkPrisma({ log: { update: async (a: { data: Record<string, unknown> }) => { updates.push(a); return {}; } } });
    const proc = new MessageDispatcherProcessor(
      prisma, stubRedis(store, published), new FlexBuilderService(),
      { pushFlex: async () => ({ lineMessageId: 'mid.1' }) } as never,
    );
    await proc.processLog('log-1');
    assert.equal(updates[updates.length - 1].data.status, 'DELIVERED');
    assert.equal(store.has('circuit:service-message:default'), false);
    ok('7a success → DELIVERED, circuit closed');
  }

  // 7b. permanent 400 → FAILED then FALLBACK_SENT (no retry sleep)
  {
    const store = new Map<string, string>();
    const statuses: string[] = [];
    const prisma = mkPrisma({ log: { update: async (a: { data: { status: string } }) => { statuses.push(a.data.status); return {}; } } });
    const proc = new MessageDispatcherProcessor(
      prisma, stubRedis(store, []), new FlexBuilderService(),
      { pushFlex: async () => { throw new PermanentLineError('bad', 400); } } as never,
    );
    await proc.processLog('log-1');
    assert.deepEqual(statuses, ['PROCESSING', 'FAILED', 'FALLBACK_SENT']);
    ok('7b permanent error → FAILED → FALLBACK_SENT without retries');
  }

  // 7c. circuit open → fallback without LINE attempt
  {
    const store = new Map([['circuit:service-message:default', '5']]);
    let calls = 0;
    const statuses: string[] = [];
    const prisma = mkPrisma({ log: { update: async (a: { data: { status: string } }) => { statuses.push(a.data.status); return {}; } } });
    const proc = new MessageDispatcherProcessor(
      prisma, stubRedis(store, []), new FlexBuilderService(),
      { pushFlex: async () => { calls++; return { lineMessageId: null }; } } as never,
    );
    await proc.processLog('log-1');
    assert.equal(calls, 0);
    assert.deepEqual(statuses, ['FALLBACK_SENT']);
    ok('7c open circuit routes fallback, zero LINE calls');
  }

  // 7d. terminal rows are no-ops (idempotent redelivery)
  {
    let reads = 0;
    const prisma = {
      notificationLog: { findUnique: async () => { reads++; return { id: 'log-9', status: 'DELIVERED' }; } },
    } as unknown as PrismaService;
    const proc = new MessageDispatcherProcessor(
      prisma, stubRedis(new Map(), []), new FlexBuilderService(), {} as never,
    );
    await proc.processLog('log-9');
    assert.equal(reads, 1);
    ok('7d terminal rows are idempotent no-ops');
  }

  // 7e. retryable then success on 2nd attempt
  {
    const store = new Map<string, string>();
    let calls = 0;
    const prisma = mkPrisma({});
    const proc = new MessageDispatcherProcessor(
      prisma, stubRedis(store, []), new FlexBuilderService(),
      {
        pushFlex: async () => {
          calls++;
          if (calls === 1) throw new RetryableLineError('rl', 429);
          return { lineMessageId: 'mid.2' };
        },
      } as never,
    );
    await proc.processLog('log-1');
    assert.equal(calls, 2);
    ok('7e 429 retried with backoff then DELIVERED');
  }
}

// ---------- 8. HMAC tickets + SDL + admin console wiring (Gate 4/1) ----------
{
  const sig = signDeliveryTicket('123e4567-e89b-12d3-a456-426614174001', 'DELIVERED');
  assert.equal(verifyDeliveryTicket('123e4567-e89b-12d3-a456-426614174001', 'DELIVERED', sig), true);
  assert.equal(verifyDeliveryTicket('123e4567-e89b-12d3-a456-426614174001', 'FAILED', sig), false);
  assert.equal(verifyDeliveryTicket('123e4567-e89b-12d3-a456-426614174001', 'DELIVERED', 'forged'), false);
  const sdl = readFileSync('apps/backend/src/api/graphql/schemas/service-message.graphql/schema.graphql', 'utf8');
  for (const t of ServiceMessageTypeEnum.options) assert.ok(sdl.includes(t), `SDL missing ${t}`);
  const page = readFileSync('apps/frontend/app/(admin)/notifications/page.tsx', 'utf8');
  assert.ok(page.includes('/api/v1/admin/notifications/stats'));
  assert.ok(page.includes('FALLBACK_SENT'));
  ok('HMAC fail-closed; SDL mirrors enum; admin page binds stats API');
}

console.log(`\nPhase 024 contracts: ${passed} checks passed`);
}

void main();
