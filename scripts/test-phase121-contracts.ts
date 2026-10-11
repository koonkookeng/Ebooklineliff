// SSOT Phase 121 §10-11 — contract tests (Zod, traceparent, scrub, ALS,
// OTel seam, metrics, pino, interceptor/filter, LIFF ring, configs,
// Prisma Gate 1, barrel).
// Run: npx tsx scripts/test-phase121-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TelemetryLogLevelEnum,
  ObservabilityEnvironmentEnum,
  StructuredLogPayloadSchema,
  SentryUserScopeSchema,
  TRACE_EXPORT_BUDGET_MS,
  LIFF_LOG_BUFFER_BYTES,
  INCIDENT_ALERT_BUDGET_MS,
  ERROR_RATE_TRIP_PCT,
  ERROR_RATE_WINDOW_SEC,
  LIFF_RAM_TRIP_BYTES,
  TRACEPARENT_VERSION,
  PII_DENY_KEYS,
  REDACTED,
  parseTraceparent,
  buildTraceparent,
  newTraceIds,
  scrubPii,
  telemetryStreamKey,
} from '../packages/shared/src/schemas/telemetry-contract';
import {
  currentTrace,
  runWithChildSpan,
  runWithRootTrace,
  resolveInboundContext,
  runWithTrace,
} from '../apps/backend/src/infra/observability/trace-context.holder';
import {
  initTelemetry,
  isTelemetryActive,
  telemetryKind,
  __resetTelemetryForTests,
} from '../apps/backend/src/infra/observability/open-telemetry.sdk';
import { MetricsService } from '../apps/backend/src/infra/observability/metrics.service';
import { PinoLoggerService } from '../apps/backend/src/infra/logger/pino-logger.service';
import { redactPii, containsPiiKeys } from '../apps/backend/src/infra/logger/redact-pii.utility';
import { TelemetryInterceptor } from '../apps/backend/src/common/interceptors/telemetry.interceptor';
import { SentryExceptionFilter } from '../apps/backend/src/common/filters/sentry-exception.filter';

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
// ---------- 1. Zod SSOT verbatim (§3.1 Gate 1) ----------
{
  for (const v of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
    assert.equal(TelemetryLogLevelEnum.safeParse(v).success, true, v);
  }
  assert.equal(TelemetryLogLevelEnum.safeParse('VERBOSE').success, false);
  for (const v of ['DEVELOPMENT', 'STAGING', 'PRODUCTION']) {
    assert.equal(ObservabilityEnvironmentEnum.safeParse(v).success, true, v);
  }
  assert.equal(
    StructuredLogPayloadSchema.safeParse({
      traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), timestamp: '2026-01-01T00:00:00.000Z',
      level: 'INFO', serviceName: 'svc', action: 'act', message: 'msg', context: { ok: 1 },
    }).success,
    true,
  );
  assert.equal(
    StructuredLogPayloadSchema.safeParse({
      traceId: '', spanId: 'b', timestamp: 'not-a-date', level: 'INFO', serviceName: 'svc',
      action: 'act', message: 'msg', context: {},
    }).success,
    false,
  );
  assert.equal(
    SentryUserScopeSchema.safeParse({ id: 'u1', role: 'MEMBER', tenantId: 't1', ip_address: '[REDACTED]' }).success,
    true,
  );
  assert.equal(
    SentryUserScopeSchema.safeParse({ id: 'u1', role: 'MEMBER', tenantId: 't1', ip_address: '1.1.1.1' }).success,
    false,
  );
  assert.equal(TRACE_EXPORT_BUDGET_MS, 1.5);
  assert.equal(LIFF_LOG_BUFFER_BYTES, 512000);
  assert.equal(INCIDENT_ALERT_BUDGET_MS, 500);
  assert.equal(ERROR_RATE_TRIP_PCT, 5);
  assert.equal(ERROR_RATE_WINDOW_SEC, 60);
  assert.equal(LIFF_RAM_TRIP_BYTES, 29360128);
  assert.equal(TRACEPARENT_VERSION, '00');
  assert.ok((PII_DENY_KEYS as readonly string[]).includes('lineUserId'));
  assert.equal(REDACTED, '[REDACTED]');
  ok('1. Zod SSOT verbatim (levels/env/payload/PII-literal) + budgets');
}

// ---------- 2. W3C traceparent + ids ----------
{
  const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  assert.deepEqual(parseTraceparent(header), { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true });
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00')?.sampled, false);
  assert.equal(parseTraceparent(undefined), null);
  assert.equal(parseTraceparent('garbage'), null);
  assert.equal(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), null);
  assert.equal(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), null);
  assert.equal(buildTraceparent('a'.repeat(32), 'b'.repeat(16)), `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  assert.equal(buildTraceparent('a'.repeat(32), 'b'.repeat(16), false).endsWith('-00'), true);
  const ids = newTraceIds();
  assert.match(ids.traceId, /^[0-9a-f]{32}$/);
  assert.match(ids.spanId, /^[0-9a-f]{16}$/);
  assert.notEqual(newTraceIds().traceId, ids.traceId);
  const roundtrip = parseTraceparent(buildTraceparent(ids.traceId, ids.spanId));
  assert.deepEqual(roundtrip, { traceId: ids.traceId, spanId: ids.spanId, sampled: true });
  ok('2. Traceparent parse/build/ids + ff/zero/garbage guards');
}

// ---------- 3. PII scrub matrix (§8.1) ----------
{
  const dirty = {
    password: 'hunter2',
    nested: { accessToken: 'tok', lineUserId: 'U123', ok: 'fine' },
    list: [{ slipImageUrl: 'https://x/s.jpg' }, { bankAccountNumber: '1234567890' }],
    idCardNumber: '1100100000000',
    phone: '081-234-5678',
    plain: 'hello',
  };
  const clean = scrubPii(dirty);
  assert.deepEqual([clean.password, clean.nested.accessToken, clean.nested.lineUserId, clean.nested.ok], ['[REDACTED]', '[REDACTED]', '[REDACTED]', 'fine']);
  assert.equal((clean.list as unknown as Array<Record<string, string>>)[0]!['slipImageUrl'], '[REDACTED]');
  assert.equal(clean.idCardNumber, '[REDACTED]');
  assert.equal(clean.phone, '[REDACTED]');
  assert.equal(clean.plain, 'hello');
  assert.equal(scrubPii({ count: 3 }).count, 3);
  assert.equal(scrubPii('sk-abcdef1234567890'), '[REDACTED]');
  assert.equal(containsPiiKeys({ a: { lineUserId: 'U1' } }), true);
  assert.equal(containsPiiKeys({ a: { nick: 'x' } }), false);
  assert.equal(redactPii({ password: 'x' }).password, '[REDACTED]');
  assert.equal(containsPiiKeys({ password: 'x' }), true);
  const viaUtil = redactPii({ idCardNumber: '1100100000000', keep: 1 });
  assert.deepEqual([viaUtil.idCardNumber, viaUtil.keep], ['[REDACTED]', 1]);
  ok('3. Denylist keys + secret shapes + 13-digit + phone + facade parity');
}

// ---------- 4. ALS carrier (isolated contexts, child spans, inbound) ----------
{
  assert.equal(currentTrace(), undefined);
  const first = runWithRootTrace(() => currentTrace());
  assert.ok(first && /^[0-9a-f]{32}$/.test(first.traceId));
  const pair = runWithRootTrace(() => {
    const r = currentTrace()!;
    const c = runWithChildSpan(r, () => currentTrace());
    return { r, c };
  });
  const root = pair.r;
  const child = pair.c;
  assert.ok(child && child.traceId === root.traceId && child.spanId !== root.spanId && child.spanId.length === 16);
  // isolation across sequential runs.
  const a = runWithRootTrace(() => currentTrace()!.traceId);
  const b = runWithRootTrace(() => currentTrace()!.traceId);
  assert.notEqual(a, b);
  assert.equal(currentTrace(), undefined);
  // inbound: valid header wins, miss mints fresh.
  const inbound = resolveInboundContext('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', { tenantId: 'acme' });
  assert.deepEqual([inbound.context.traceId, inbound.context.tenantId], ['4bf92f3577b34da6a3ce929d0e0e4736', 'acme']);
  assert.equal(inbound.responseHeader, '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  const fresh = resolveInboundContext(undefined, { userId: 'u1' });
  assert.match(fresh.context.traceId, /^[0-9a-f]{32}$/);
  assert.equal(fresh.context.userId, 'u1');
  // explicit run.
  const seen = runWithTrace({ traceId: 't', spanId: 's' }, () => currentTrace());
  assert.deepEqual(seen, { traceId: 't', spanId: 's' });
  ok('4. ALS root/child/inbound/explicit + cross-run isolation');
}

// ---------- 5. OTel SDK seam (lazy, idempotent, no-op without package) ----------
{
  __resetTelemetryForTests();
  assert.equal(isTelemetryActive(), false);
  const first = await initTelemetry('test-svc', 'test');
  assert.equal(isTelemetryActive(), true);
  assert.equal(telemetryKind(), 'noop');
  const second = await initTelemetry('other-svc', 'prod');
  assert.equal(first, second);
  ok('5. Lazy no-op backend + idempotent init (zero-dep seam)');
}

// ---------- 6. Metrics (trio + quantiles + exposition + cap) ----------
{
  const { MetricsService: MS } = await import('../apps/backend/src/infra/observability/metrics.service');
  const m = new MS();
  assert.equal(m.observeHttpRequest('acme', 0.12), true);
  assert.equal(m.observeHttpRequest('acme', 0.3), true);
  assert.equal(m.observeSlipVerification(0.8), true);
  assert.equal(m.observeCanvasRam(20 * 1024 * 1024), true);
  assert.equal(m.increment('orders_total', { tenant: 'acme' }, 2), true);
  const snap = m.snapshot();
  assert.deepEqual([snap.counters['orders_total{tenant="acme"}'], snap.histograms['http_request_duration_seconds{tenant="acme"}']?.count], [2, 2]);
  assert.equal(snap.histograms['http_request_duration_seconds{tenant="acme"}']?.p50, 0.12);
  const text = m.expose();
  assert.ok(text.includes('orders_total{tenant="acme"} 2') && text.includes('http_request_duration_seconds{tenant="acme"}_count 2'), 'Prometheus exposition');
  // empty-series guards.
  const empty = new MS().snapshot();
  assert.deepEqual(empty.histograms, {});
  m.resetForTests();
  assert.deepEqual(m.snapshot().counters, {});
  ok('6. Counters/histograms/p50/exposition/reset (spec trio)');
}

// ---------- 7. Pino logger (JSON + trace injection + scrub) ----------
{
  const { PinoLoggerService: PLS } = await import('../apps/backend/src/infra/logger/pino-logger.service');
  const svc = new PLS('test-svc');
  const line = runWithTrace({ traceId: 't'.repeat(32), spanId: 's'.repeat(16), tenantId: 'acme', userId: 'u1' }, () =>
    svc.info('OrderCreated', 'order paid', { password: 'hunter2', amount: 100 }),
  ) as Record<string, unknown>;
  assert.deepEqual([line['traceId'], line['spanId'], line['tenantId'], line['userId'], line['serviceName']], ['t'.repeat(32), 's'.repeat(16), 'acme', 'u1', 'test-svc']);
  assert.equal((line['context'] as Record<string, unknown>)['password'], '[REDACTED]');
  assert.equal((line['context'] as Record<string, unknown>)['amount'], 100);
  const errLine = svc.error('SlipVerify', 'failed', new Error('boom'), { lineUserId: 'U9' }) as Record<string, unknown>;
  assert.equal((errLine['error'] as Record<string, unknown>)['name'], 'Error');
  assert.equal((errLine['context'] as Record<string, unknown>)['lineUserId'], '[REDACTED]');
  assert.equal((svc.warn('A', 'm') as Record<string, unknown>)['level'], 'WARN');
  assert.equal((svc.debug('A', 'm') as Record<string, unknown>)['level'], 'DEBUG');
  assert.equal((svc.trace('A', 'm') as Record<string, unknown>)['level'], 'TRACE');
  assert.equal((svc.fatal('A', 'm') as Record<string, unknown>)['level'], 'FATAL');
  ok('7. Structured lines + ALS injection + scrub + error shape + levels');
}

// ---------- 8. Interceptor (propagation + echo + duration) + filter ----------
{
  const { join } = await import('node:path');
  const rxRequire = eval('require') as (id: string) => { of: (v: unknown) => { subscribe: (a: unknown) => void; pipe: (...o: Array<(s: unknown) => unknown>) => { subscribe: (a: unknown) => void } } };
  const { of } = rxRequire(join(process.cwd(), 'apps', 'backend', 'node_modules', 'rxjs'));
  const interceptor = new TelemetryInterceptor();
  const headers: Record<string, string> = {};
  const req = { headers: { 'x-tenant-id': 'acme', traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }, user: { id: 'u1' }, traceContext: undefined as unknown };
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  const ctxFor = (handler: () => unknown) =>
    ({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }) as never;
  const seen: unknown[] = [];
  await new Promise<void>((resolve) => {
    interceptor.intercept(ctxFor(() => 'handler'), { handle: () => of('ok') } as never).subscribe(() => resolve());
  });
  assert.equal((req.traceContext as { traceId: string }).traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(headers['traceparent'], '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  void seen;
  // fresh ids on missing header.
  const req2 = { headers: {}, user: {} };
  await new Promise<void>((resolve) => {
    interceptor.intercept(
      { getHandler: () => (() => 1), switchToHttp: () => ({ getRequest: () => req2, getResponse: () => ({}) }) } as never,
      { handle: () => of(1) } as never,
    ).subscribe(() => resolve());
  });
  assert.match(((req2 as unknown as Record<string, { traceId: string }>).traceContext as { traceId: string }).traceId, /^[0-9a-f]{32}$/);

  // filter: HTTP + 500 + DB-down fail-open, reference ids attached.
  const created: unknown[] = [];
  const streams: unknown[][] = [];
  const prisma = { sentryErrorIncident: { create: async (a: unknown) => { created.push(a); return { id: 'row-1' }; } } };
  const redis = { xaddPipeline: async (...a: unknown[]) => { streams.push(a); } };
  const filter = new SentryExceptionFilter(prisma as never, redis as never);
  const { join: joinPath } = await import('node:path');
  const nestRequire = eval('require') as (id: string) => { HttpException: new (msg: string, status: number) => Error };
  const { HttpException } = nestRequire(joinPath(process.cwd(), 'apps', 'backend', 'node_modules', '@nestjs', 'common'));
  let captured: unknown = null;
  const host2 = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/x', method: 'GET', headers: {}, body: {} }),
      getResponse: () => ({ status: () => ({ json: (b: unknown) => { captured = b; } }) }),
    }),
  } as never;
  await filter.catch(new HttpException('nope', 400), host2);
  assert.deepEqual([(captured as Record<string, unknown>)['statusCode'], (captured as Record<string, unknown>)['message']], [400, 'nope']);
  await filter.catch(new Error('boom'), host2);
  const five = captured as Record<string, unknown>;
  assert.deepEqual([five['statusCode'], five['message']], [500, 'Internal server error']);
  assert.match(String(five['incidentId']), /^[0-9a-f-]{36}$/);
  assert.match(String(five['referenceId']), /^INC-/);
  assert.equal(created.length, 2);
  assert.ok(streams.some((s) => JSON.stringify(s).includes('incident.captured')), 'incident stream');
  // PII scrub pre-persist (13-digit national id in the message).
  const hostPw = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/y', method: 'POST', headers: {}, body: { password: 'hunter2' } }),
      getResponse: () => ({ status: () => ({ json: () => undefined }) }),
    }),
  } as never;
  await filter.catch(new Error('leak id 1100100000000 in message'), hostPw);
  const lastCreate = created[created.length - 1] as { data: Record<string, unknown> };
  assert.ok(!JSON.stringify(lastCreate).includes('1100100000000'), 'filter scrubs PII pre-persist');
  // DB down → response still served.
  const downFilter = new SentryExceptionFilter({ sentryErrorIncident: { create: async () => { throw new Error('db down'); } } } as never, redis as never);
  await downFilter.catch(new Error('x'), host2);
  assert.match(String((captured as Record<string, unknown>)['incidentId']), /^[0-9a-f-]{36}$/);
  ok('8. Trace echo/fresh-ids + filter envelopes (400/500/ref-ids/streams/fail-open)');
}

// ---------- 9. LIFF logger (levels/ring/scrub/beacon/config) ----------
{
  const modPath = '../apps/frontend/lib/observability/liff-logger';
  const lib = await import(modPath) as typeof import('../apps/frontend/lib/observability/liff-logger');
  lib.resetLiffLoggerForTests();
  lib.configureLiffLogger({ tenantId: 'acme' });
  const line = lib.Logger.info('CheckoutOpened', 'cart viewed', { lineUserId: 'U9', items: 2 });
  assert.equal(line.tenantId, 'acme');
  assert.equal((line.context as Record<string, unknown>)['lineUserId'], '[REDACTED]');
  assert.equal((line.context as Record<string, unknown>)['items'], 2);
  assert.match(line.traceId, /^[0-9a-f]{32}$/);
  assert.match(line.spanId, /^[0-9a-f]{16}$/);
  assert.equal(lib.Logger.error('X', 'y').level, 'ERROR');
  // ring eviction under the 500KB cap.
  lib.resetLiffLoggerForTests();
  const big = 'z'.repeat(60000);
  for (let i = 0; i < 12; i++) lib.Logger.info('Flood', big);
  assert.ok(lib.liffBufferBytes() <= 500 * 1024, `ring capped (${lib.liffBufferBytes()}B)`);
  assert.equal(lib.flushLiffLogs(), false);
  ok('9. LIFF ring (cap/evict/scrub/ids) + beacon-false without navigator');
}

// ---------- 10. Sentry configs + instrumentation (lazy, crash-free) ----------
{
  delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
  delete process.env['SENTRY_DSN'];
  const client = await import('../apps/frontend/sentry.client.config');
  const server = await import('../apps/frontend/sentry.server.config');
  assert.equal(client.sentryClientConfigured, false);
  assert.equal(server.sentryServerConfigured, false);
  const instr = await import('../apps/frontend/instrumentation');
  const prevRuntime = process.env['NEXT_RUNTIME'];
  process.env['NEXT_RUNTIME'] = 'nodejs';
  try {
    await instr.register();
  } finally {
    if (prevRuntime === undefined) delete process.env['NEXT_RUNTIME'];
    else process.env['NEXT_RUNTIME'] = prevRuntime;
  }
  const boot = (globalThis as Record<string, unknown>)['__liff_boot_ms'];
  assert.ok(typeof boot === 'number', 'boot timestamp recorded');
  const clientSrc = readFileSync('apps/frontend/sentry.client.config.ts', 'utf8');
  assert.ok(clientSrc.includes('@sentry/nextjs') && clientSrc.includes('ip_address'), 'lazy DSN gate + PII scrub');
  ok('10. Lazy sentry configs (no-DSN no-op) + instrumentation hook');
}

// ---------- 11. Prisma Gate 1 (levels + incident/audit models) ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const v of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
    assert.ok(prisma.includes(v), `LogLevel ${v}`);
  }
  for (const m of ['enum LogLevel', 'model SystemAuditLog', 'model SentryErrorIncident']) {
    assert.ok(prisma.includes(m), m);
  }
  assert.ok(prisma.includes('ipAddress   String   @default("[REDACTED]")'), 'PII-default IP column');
  assert.ok(prisma.includes('sentryId       String   @unique'), 'incident dedupe key');
  assert.ok(prisma.includes('systemAuditLogs    SystemAuditLog[]'), 'User back-relation');
  assert.ok(prisma.includes('@@index([traceId])'), 'trace lookup index');
  const trigger = readFileSync('packages/db/prisma/audit-immutability.trigger.sql', 'utf8');
  assert.ok(trigger.includes('enforce_audit_log_immutability'), '118 trigger doc intact');
  ok('11. Prisma Gate 1 (LogLevel + 2 models + redacted default + keys)');
}

// ---------- 12. Tree parity + barrel (no TODO/placeholder, no dupes) ----------
{
  for (const f of [
    'apps/backend/src/infra/observability/trace-context.holder.ts',
    'apps/backend/src/infra/observability/open-telemetry.sdk.ts',
    'apps/backend/src/infra/observability/metrics.service.ts',
    'apps/backend/src/infra/logger/pino-logger.service.ts',
    'apps/backend/src/infra/logger/redact-pii.utility.ts',
    'apps/backend/src/common/interceptors/telemetry.interceptor.ts',
    'apps/backend/src/common/filters/sentry-exception.filter.ts',
    'apps/frontend/instrumentation.ts',
    'apps/frontend/sentry.client.config.ts',
    'apps/frontend/sentry.server.config.ts',
    'apps/frontend/lib/observability/liff-logger.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('TODO') && !src.includes('placeholder'), `${f} unimplemented`);
  }
  const barrel = readFileSync('packages/shared/src/index.ts', 'utf8');
  for (const e of ['StructuredLogPayloadSchema', 'SentryUserScopeSchema', 'parseTraceparent', 'scrubPii', 'TRACE_EXPORT_BUDGET_MS', 'LIFF_LOG_BUFFER_BYTES']) {
    assert.ok(barrel.includes(e), `barrel ${e}`);
  }
  // 052 telemetry section + logging.interceptor stay out of scope (untouched).
  const ctl = readFileSync('packages/shared/src/schemas/analytics-contract.ts', 'utf8');
  assert.ok(!ctl.includes('StructuredLogPayload'), '052 contract untouched');
  const logging = readFileSync('apps/backend/src/common/interceptors/logging.interceptor.ts', 'utf8');
  assert.ok(logging.includes('placeholder'), 'out-of-scope interceptor untouched');
  ok('12. 121 tree parity + barrel + scope discipline');
}
}

main()
  .then(() => console.log(`\nPhase 121 contracts: ${passed}/12 groups passed`))
  .catch((err) => {
    console.error('\nPhase 121 contracts FAILED:', err);
    process.exit(1);
  });
