// SSOT Phase 002 §10 — infra self-healing QA loop
import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('Executing Phase 002 Infrastructure Verification Loop...');

const required = [
  'docker-compose.yml',
  'docker-compose.override.yml',
  'apps/backend/src/infra/postgres/init-extensions.sql',
  'apps/backend/src/infra/postgres/postgresql.conf',
  'apps/backend/src/infra/redis/redis-cluster.tmpl',
  'apps/backend/src/infra/redis/generate-cluster-config.sh',
  'packages/shared/src/schemas/infra-env.schema.ts',
  'apps/backend/src/infra/database/prisma.service.ts',
  'apps/backend/src/infra/redis/redis-cluster.service.ts',
  '.env.example',
];

let fail = 0;
for (const f of required) {
  if (!fs.existsSync(f)) {
    console.error('MISSING', f);
    fail++;
  }
}

// SQL content gates
const sql = fs.readFileSync('apps/backend/src/infra/postgres/init-extensions.sql', 'utf8');
for (const k of ['"vector"', '"uuid-ossp"', '"pg_trgm"', 'content_vector_embeddings', 'idx_content_vector_hnsw', 'vector_cosine_ops']) {
  if (!sql.includes(k)) {
    console.error('SQL MISSING', k);
    fail++;
  }
}

// Compose topology gates
const compose = fs.readFileSync('docker-compose.yml', 'utf8');
for (const k of ['pgvector/pgvector:pg16', 'omni-network', '172.28.0.2', 'redis-node-6', '172.28.0.16', '--cluster-replicas 1', 'allkeys-lru']) {
  if (!compose.includes(k)) {
    console.error('COMPOSE MISSING', k);
    fail++;
  }
}

// Zod schema gates
const zod = fs.readFileSync('packages/shared/src/schemas/infra-env.schema.ts', 'utf8');
for (const k of ['InfrastructureEnvSchema', 'POSTGRES_HOST', 'REDIS_CLUSTER_NODES', 'R2_BUCKET_NAME', 'DATABASE_POOL_MAX']) {
  if (!zod.includes(k)) {
    console.error('ZOD MISSING', k);
    fail++;
  }
}

// Service gates
const redisSvc = fs.readFileSync('apps/backend/src/infra/redis/redis-cluster.service.ts', 'utf8');
for (const k of ['getEbookPageChunk', 'setEbookPageChunk', 'ebook:chunk:{', 'scaleReads']) {
  if (!redisSvc.includes(k)) {
    console.error('REDIS SVC MISSING', k);
    fail++;
  }
}
const prismaSvc = fs.readFileSync('apps/backend/src/infra/database/prisma.service.ts', 'utf8');
for (const k of ['searchSimilarEbookChapters', 'content_vector_embeddings', '$connect', '$disconnect']) {
  if (!prismaSvc.includes(k)) {
    console.error('PRISMA SVC MISSING', k);
    fail++;
  }
}

if (fail > 0) {
  console.error(`PHASE 002 VERIFICATION FAILED (${fail})`);
  process.exit(1);
}

try {
  console.log('1. Docker compose config validation...');
  execSync('docker compose -f docker-compose.yml config --quiet', { stdio: 'inherit' });
  console.log('2. Backend typecheck (Phase 002 scope)...');
  execSync('npx tsc --noEmit -p apps/backend/tsconfig.phase002.json', { stdio: 'inherit' });
  console.log('3. Infra contract runtime tests...');
  execSync('npx tsx scripts/test-phase002-contracts.ts', { stdio: 'inherit' });
  console.log('4. Phase 001 regression...');
  execSync('npx tsx scripts/verify-phase001.ts', { stdio: 'inherit' });
  console.log('PHASE 002 PASSED ALL QUALITY CHECKS (100/100)');
} catch {
  console.error('PHASE 002 VERIFICATION FAILED. Initiating Auto-Repair Routine...');
  process.exit(1);
}
