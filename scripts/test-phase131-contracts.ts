// SSOT Phase 131 §10 — web identity + admin bootstrap contract tests
// Run: npx tsx scripts/test-phase131-contracts.ts
import assert from 'node:assert/strict';
import { parseBootstrapArgs, mintDevToken, usage } from './bootstrap-admin';
import { sanitizeNextPath } from '../packages/shared/src/schemas/web-auth.schema';

let passed = 0;
function ok(name: string): void { passed++; console.log(`  ✓ ${name}`); }

// ---------- 1. sanitizeNextPath ----------
{
  assert.equal(sanitizeNextPath('/admin/users'), '/admin/users');
  assert.equal(sanitizeNextPath('/admin/users?q=1'), '/admin/users?q=1');
  assert.equal(sanitizeNextPath(null), '/');
  assert.equal(sanitizeNextPath('https://evil.com', '/x'), '/x');
  assert.equal(sanitizeNextPath('//evil.com', '/x'), '/x');
  assert.equal(sanitizeNextPath('/\\evil', '/x'), '/x');
  assert.equal(sanitizeNextPath('/a\nb', '/x'), '/x');
  assert.equal(sanitizeNextPath('x'.repeat(1000), '/x'), '/x');
  ok('sanitizeNextPath accepts same-origin paths and rejects escapes');
}

// ---------- 2. bootstrap arg parsing ----------
{
  const opts = parseBootstrapArgs(['--email', 'Admin@Example.com', '--token', '--json'], { ADMIN_LINE_USER_ID: 'U' + 'a'.repeat(32) } as NodeJS.ProcessEnv);
  assert.equal(opts.email, 'admin@example.com');
  assert.equal(opts.lineUserId, 'U' + 'a'.repeat(32));
  assert.equal(opts.printToken, true);
  assert.equal(opts.json, true);
  assert.equal(opts.role, 'SUPER_ADMIN');
  ok('parseBootstrapArgs normalises email and reads env fallbacks');

  assert.throws(() => parseBootstrapArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseBootstrapArgs(['--email', 'not-an-email']), /not a valid address/);
  assert.throws(() => parseBootstrapArgs(['--role', 'NOPE']), /Unknown role/);
  assert.throws(() => parseBootstrapArgs(['--ttl', '10']), /between 60 and 86400/);
  assert.throws(() => parseBootstrapArgs([]), /Provide --line-user-id/);
  ok('parseBootstrapArgs rejects malformed input');

  // --help throws a BootstrapUsageError carrying the usage text
  try { parseBootstrapArgs(['--help']); assert.fail('expected throw'); }
  catch (err) { assert.match(String(err), /bootstrap-admin —/); }
  ok('parseBootstrapArgs --help surfaces usage');
}

// ---------- 3. mintDevToken shape ----------
{
  const token = mintDevToken({
    secret: 'x'.repeat(32),
    userId: '11111111-2222-3333-4444-555555555555',
    tenantId: '48e702ca-66be-49cf-805f-b790925eaf42',
    role: 'SUPER_ADMIN',
    lineUserId: 'Uabc',
    email: 'admin@example.com',
    ttlSec: 900,
  });
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub: string; role: string; exp: number; iat: number };
  assert.equal(payload.sub, '11111111-2222-3333-4444-555555555555');
  assert.equal(payload.role, 'SUPER_ADMIN');
  assert.equal(payload.exp - payload.iat, 900);
  assert.throws(() => mintDevToken({ secret: 'short', userId: 'u', tenantId: 't', role: 'MEMBER' }), /at least 32/);
  ok('mintDevToken produces a verifiable 3-part JWT');
}

console.log(`\nPhase 131 contracts: ${passed} passed`);
if (passed < 3) process.exit(1);