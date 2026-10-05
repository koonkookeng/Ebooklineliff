// SSOT Phase 001 — Zod contract tests (happy + edge + failure)
import assert from 'node:assert';
import { AppConfigSchema, HealthCheckResponseSchema } from '../packages/shared/src/index';

const baseEnv = {
  DATABASE_URL: 'postgresql://ebook:ebook@localhost:5432/ebook_liff',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

// 1. happy: defaults applied
const happy = AppConfigSchema.parse(baseEnv);
assert.equal(happy.NODE_ENV, 'development');
assert.equal(happy.PORT, 4000);
assert.equal(happy.FRONTEND_URL, 'http://localhost:3000');

// 2. edge: PORT coerced from string, staging env
const edge = AppConfigSchema.parse({ ...baseEnv, PORT: '3001', NODE_ENV: 'staging' });
assert.equal(edge.PORT, 3001);

// 3. failure: missing DATABASE_URL / short JWT_SECRET / bad URL
assert.throws(() => AppConfigSchema.parse({ ...baseEnv, DATABASE_URL: '' }));
assert.throws(() => AppConfigSchema.parse({ ...baseEnv, JWT_SECRET: 'short' }));
assert.throws(() => AppConfigSchema.parse({ ...baseEnv, FRONTEND_URL: 'not-a-url' }));

// 4. health response happy + tenant optional
const health = HealthCheckResponseSchema.parse({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: 1.5,
  engine: 'Fastify Engine',
  version: '1.0.0',
});
assert.equal(health.status, 'ok');
const withTenant = HealthCheckResponseSchema.parse({ ...health, tenantContext: 'acme' });
assert.equal(withTenant.tenantContext, 'acme');

// 5. health failure: wrong engine literal / bad timestamp
assert.throws(() =>
  HealthCheckResponseSchema.parse({ ...health, engine: 'Express' }),
);
assert.throws(() => HealthCheckResponseSchema.parse({ ...health, timestamp: 'yesterday' }));

console.log('contract tests: 5/5 groups passed');
