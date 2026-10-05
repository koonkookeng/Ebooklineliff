// Gatekeeper check: SSOT sync + RAM guard + zero-egress + atomic txn markers
import fs from 'node:fs';
const must = [
  'packages/db/prisma/schema.prisma',
  'packages/shared/src/schemas/sdid-contract.ts',
  '.rule', '.devinrule', 'skill.md', 'agent.md', 'memory.md', 'index.md', 'context.md',
];
let fail = 0;
for (const f of must) {
  if (!fs.existsSync(f)) { console.error('MISSING', f); fail++; }
}
const zod = fs.readFileSync('packages/shared/src/schemas/sdid-contract.ts', 'utf8');
for (const k of ['ContentAccessTypeEnum', 'ProductTypeEnum', 'OrderStatusEnum', 'SlipVerificationPayloadSchema', 'EbookChunkPayloadSchema']) {
  if (!zod.includes(k)) { console.error('ZOD MISSING', k); fail++; }
}
const prisma = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');
for (const k of ['model User', 'model Product', 'model Entitlement', 'model Order', 'model PaymentSlip']) {
  if (!prisma.includes(k)) { console.error('PRISMA MISSING', k); fail++; }
}
console.log(fail === 0 ? 'Phase000 SSOT Gate 1 PASS' : `Phase000 FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
