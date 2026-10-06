// SSOT Phase 006 QA loop (schema + scoped typecheck + contracts + integration + regressions)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('Executing Phase 006 Verification Loop...');

const required = [
  'packages/shared/src/schemas/auth-contract.ts',
  'packages/db/prisma/schema.prisma',
  'apps/backend/src/modules/auth/services/line-verifier.service.ts',
  'apps/backend/src/modules/auth/services/jwt-token.service.ts',
  'apps/backend/src/modules/auth/services/auth.service.ts',
  'apps/backend/src/modules/auth/guards/line-liff.guard.ts',
  'apps/backend/src/modules/auth/dto/liff-auth.dto.ts',
  'apps/backend/src/modules/auth/auth.module.ts',
  'apps/backend/src/api/graphql/resolvers/auth.resolver.ts',
  'apps/backend/src/api/graphql/schema/type-defs.ts',
  'apps/frontend/providers/LiffAuthProvider.tsx',
  'apps/frontend/hooks/useLiffAuth.ts',
  'apps/frontend/app/(liff)/auth/page.tsx',
  'apps/frontend/middleware.ts',
  'docs/adr/ADR-006-line-liff-auth.md',
];

let fail = 0;
for (const f of required) {
  if (!fs.existsSync(f)) {
    console.error('MISSING', f);
    fail++;
  }
}

const prisma = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');
for (const k of ['model Tenant', 'model LineAuthProfile', 'lineProfile', 'lastLoginAt', 'lineChannelId']) {
  if (!prisma.includes(k)) {
    console.error('PRISMA MISSING', k);
    fail++;
  }
}

const contract = fs.readFileSync('packages/shared/src/schemas/auth-contract.ts', 'utf8');
for (const k of ['LiffAuthInputSchema', 'DecodedLineTokenSchema', 'UserProfileAuthSchema', 'AuthTokenResponseSchema']) {
  if (!contract.includes(k)) {
    console.error('CONTRACT MISSING', k);
    fail++;
  }
}

if (fail > 0) {
  console.error(`PHASE 006 VERIFICATION FAILED (${fail})`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: 'postgresql://ebook:ebook@localhost:5432/ebook_liff' };
try {
  console.log('1. Prisma schema validation...');
  execSync('npx prisma validate --schema packages/db/prisma/schema.prisma', { stdio: 'inherit', env });
  console.log('2. Backend typecheck (Phase 005+006 scope)...');
  execSync('npx tsc --noEmit -p apps/backend/tsconfig.phase005.json', { stdio: 'inherit' });
  console.log('3. Frontend typecheck...');
  execSync('npx tsc --noEmit -p apps/frontend/tsconfig.json', { stdio: 'inherit' });
  console.log('4. Phase 006 contract + integration tests...');
  execSync('npx tsx scripts/test-phase006-contracts.ts', { stdio: 'inherit' });
  console.log('5. Phase 005 contract regression...');
  execSync('npx tsx scripts/test-phase005-contracts.ts', { stdio: 'inherit' });
  console.log('6. Phase 003+004 contract regression...');
  execSync('npx tsx scripts/test-phase003-004-contracts.ts', { stdio: 'inherit' });
  console.log('PHASE 006 PASSED ALL QUALITY CHECKS (100/100)');
} catch {
  console.error('PHASE 006 VERIFICATION FAILED. Initiating Auto-Repair Routine...');
  process.exit(1);
}
