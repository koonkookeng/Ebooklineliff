// SSOT Phase 008 QA loop (schema + scoped typecheck + contracts + integration + regressions)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

console.log('Executing Phase 008 Verification Loop...');

const required = [
  'packages/shared/src/schemas/catalog.zod.ts',
  'packages/db/prisma/schema.prisma',
  'apps/backend/src/modules/catalog/domain/entities/product.entity.ts',
  'apps/backend/src/modules/catalog/domain/entities/physical-detail.entity.ts',
  'apps/backend/src/modules/catalog/domain/entities/ebook-detail.entity.ts',
  'apps/backend/src/modules/catalog/domain/entities/course-detail.entity.ts',
  'apps/backend/src/modules/catalog/domain/events/product-created.event.ts',
  'apps/backend/src/modules/catalog/domain/events/stock-reserved.event.ts',
  'apps/backend/src/modules/catalog/domain/value-objects/money.vo.ts',
  'apps/backend/src/modules/catalog/domain/value-objects/sku.vo.ts',
  'apps/backend/src/modules/catalog/infrastructure/repositories/prisma-catalog.repository.ts',
  'apps/backend/src/modules/catalog/infrastructure/mappers/product.mapper.ts',
  'apps/backend/src/modules/catalog/application/commands/create-product.command.ts',
  'apps/backend/src/modules/catalog/application/commands/update-stock.command.ts',
  'apps/backend/src/modules/catalog/application/queries/get-product-by-slug.query.ts',
  'apps/backend/src/modules/catalog/application/queries/list-catalog.query.ts',
  'apps/backend/src/modules/catalog/presentation/graphql/catalog.resolver.ts',
  'apps/backend/src/modules/catalog/presentation/rest/catalog-admin.controller.ts',
  'apps/backend/src/modules/catalog/catalog.module.ts',
  'apps/frontend/lib/catalog.ts',
  'docs/adr/ADR-008-product-catalog.md',
];

let fail = 0;
for (const f of required) {
  if (!fs.existsSync(f)) {
    console.error('MISSING', f);
    fail++;
  }
}

const prisma = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');
for (const k of ['enum ProductStatus', 'model BundleItem', 'model EbookChapter', 'model CourseSection', 'model CourseLesson', 'model Category', 'model Tag', 'reservedQty', 'deletedAt', 'bundleParents']) {
  if (!prisma.includes(k)) {
    console.error('PRISMA MISSING', k);
    fail++;
  }
}

const contract = fs.readFileSync('packages/shared/src/schemas/catalog.zod.ts', 'utf8');
for (const k of ['ProductStatusEnum', 'CreatePhysicalDetailSchema', 'CreateEbookDetailSchema', 'CreateCourseDetailSchema', 'CreateProductSchema']) {
  if (!contract.includes(k)) {
    console.error('CONTRACT MISSING', k);
    fail++;
  }
}

if (fail > 0) {
  console.error(`PHASE 008 VERIFICATION FAILED (${fail})`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: 'postgresql://ebook:ebook@localhost:5432/ebook_liff' };
try {
  console.log('1. Prisma schema validation...');
  execSync('npx prisma validate --schema packages/db/prisma/schema.prisma', { stdio: 'inherit', env });
  console.log('2. Backend typecheck (Phase 008 scope)...');
  execSync('npx tsc --noEmit -p apps/backend/tsconfig.phase008.json', { stdio: 'inherit' });
  console.log('3. Frontend typecheck...');
  execSync('npx tsc --noEmit -p apps/frontend/tsconfig.json', { stdio: 'inherit' });
  console.log('4. Phase 008 contract + integration tests...');
  execSync('npx tsx scripts/test-phase008-contracts.ts', { stdio: 'inherit' });
  console.log('5. Phase 007 contract regression...');
  execSync('npx tsx scripts/test-phase007-contracts.ts', { stdio: 'inherit' });
  console.log('6. Phase 006 contract regression...');
  execSync('npx tsx scripts/test-phase006-contracts.ts', { stdio: 'inherit' });
  console.log('PHASE 008 PASSED ALL QUALITY CHECKS (100/100)');
} catch {
  console.error('PHASE 008 VERIFICATION FAILED. Initiating Auto-Repair Routine...');
  process.exit(1);
}
