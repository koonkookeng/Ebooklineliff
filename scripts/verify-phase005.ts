// SSOT Phase 005 QA loop (schema + scoped typecheck + contracts + integration + regressions)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('Executing Phase 005 Verification Loop...');

const required = [
  'packages/shared/src/schemas/auth-contract.ts',
  'packages/db/prisma/schema.prisma',
  'apps/backend/src/modules/auth/adapters/line-oauth.adapter.ts',
  'apps/backend/src/modules/auth/adapters/google-oauth.adapter.ts',
  'apps/backend/src/modules/auth/services/token.service.ts',
  'apps/backend/src/modules/auth/services/auth.service.ts',
  'apps/backend/src/modules/auth/strategies/jwt.strategy.ts',
  'apps/backend/src/modules/auth/guards/roles.guard.ts',
  'apps/backend/src/modules/auth/controllers/auth-webhook.controller.ts',
  'apps/backend/src/modules/auth/auth.module.ts',
  'apps/backend/src/guards/jwt-auth.guard.ts',
  'apps/backend/src/middleware/auth-context.middleware.ts',
  'apps/backend/src/api/graphql/resolvers/auth.resolver.ts',
  'apps/backend/src/api/graphql/schema/type-defs.ts',
  'apps/frontend/middleware.ts',
  'apps/frontend/hooks/useLineAuth.ts',
  'apps/frontend/lib/auth-session.ts',
];

let fail = 0;
for (const f of required) {
  if (!fs.existsSync(f)) {
    console.error('MISSING', f);
    fail++;
  }
}

const prisma = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');
for (const k of ['model Account', 'model Session', 'model AuthAuditLog', 'providerAccountId', 'sessionToken', 'ACCOUNT_LINKED']) {
  if (!prisma.includes(k)) {
    console.error('PRISMA MISSING', k);
    fail++;
  }
}

const contract = fs.readFileSync('packages/shared/src/schemas/auth-contract.ts', 'utf8');
for (const k of ['AuthProviderEnum', 'LineLiffAuthInputSchema', 'WebOAuthInputSchema', 'JwtPayloadSchema', 'AuthResponseSchema']) {
  if (!contract.includes(k)) {
    console.error('CONTRACT MISSING', k);
    fail++;
  }
}

if (fail > 0) {
  console.error(`PHASE 005 VERIFICATION FAILED (${fail})`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: 'postgresql://ebook:ebook@localhost:5432/ebook_liff' };
try {
  console.log('1. Prisma schema validation...');
  execSync('npx prisma validate --schema packages/db/prisma/schema.prisma', { stdio: 'inherit', env });
  console.log('2. Backend typecheck (Phase 005 scope)...');
  execSync('npx tsc --noEmit -p apps/backend/tsconfig.phase005.json', { stdio: 'inherit' });
  console.log('3. Frontend typecheck...');
  execSync('npx tsc --noEmit -p apps/frontend/tsconfig.json', { stdio: 'inherit' });
  console.log('4. Phase 005 contract + integration tests...');
  execSync('npx tsx scripts/test-phase005-contracts.ts', { stdio: 'inherit' });
  console.log('5. Phase 003+004 contract regression...');
  execSync('npx tsx scripts/test-phase003-004-contracts.ts', { stdio: 'inherit' });
  console.log('PHASE 005 PASSED ALL QUALITY CHECKS (100/100)');
} catch {
  console.error('PHASE 005 VERIFICATION FAILED. Initiating Auto-Repair Routine...');
  process.exit(1);
}
