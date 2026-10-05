// SSOT Phase 002 — infra env contract tests (happy + edge + failure)
import assert from 'node:assert';
import { InfrastructureEnvSchema } from '../packages/shared/src/schemas/infra-env.schema';

const base = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_DB: 'ebook_liff',
  POSTGRES_USER: 'ebook',
  POSTGRES_PASSWORD: 'changeme-8chars-min',
  DATABASE_URL: 'https://postgres.local/ebook_liff',
  REDIS_CLUSTER_NODES: 'localhost:6379',
  REDIS_PASSWORD: 'changeme-8chars-min',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'key123',
  R2_SECRET_ACCESS_KEY: 'secret123',
  R2_BUCKET_NAME: 'ebook-chunks',
  R2_PUBLIC_DOMAIN: 'https://media.example.com',
};

// 1. happy: defaults applied
const happy = InfrastructureEnvSchema.parse(base);
assert.equal(happy.NODE_ENV, 'development');
assert.equal(happy.POSTGRES_PORT, 5432);
assert.equal(happy.DATABASE_POOL_MIN, 10);
assert.equal(happy.DATABASE_POOL_MAX, 100);

// 2. edge: ports/pools coerced from string
const edge = InfrastructureEnvSchema.parse({
  ...base,
  POSTGRES_PORT: '5433',
  DATABASE_POOL_MIN: '5',
  DATABASE_POOL_MAX: '50',
});
assert.equal(edge.POSTGRES_PORT, 5433);
assert.equal(edge.DATABASE_POOL_MIN, 5);

// 3. failure: short passwords / bad urls / empty host
assert.throws(() => InfrastructureEnvSchema.parse({ ...base, POSTGRES_PASSWORD: 'short' }));
assert.throws(() => InfrastructureEnvSchema.parse({ ...base, REDIS_PASSWORD: 'short' }));
assert.throws(() => InfrastructureEnvSchema.parse({ ...base, DATABASE_URL: 'not-a-url' }));
assert.throws(() => InfrastructureEnvSchema.parse({ ...base, R2_PUBLIC_DOMAIN: 'nope' }));
assert.throws(() => InfrastructureEnvSchema.parse({ ...base, POSTGRES_HOST: '' }));

console.log('infra contract tests: 3/3 groups passed');
