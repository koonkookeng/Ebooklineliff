// SSOT Phase 028 §10 — contract tests (Zod, parity, ingestor, guard, R2, wiring)
// Run: npx tsx scripts/test-phase028-contracts.ts (loop 3x before mark complete per skill.md)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NativeCspReportSchema,
  CspReportPayloadSchema,
  AnyCspReportEnvelopeSchema,
  DomainWhitelistConfigSchema,
  HlsStreamTokenPayloadSchema,
  CspViolationRecordSchema,
  SecuritySeverityEnum,
  CSP_REPORT_PATH,
  CSP_QUEUE,
  CSP_MAX_BYTES,
  R2_CORS_MAX_AGE,
  normalizeCspReport,
  classifyCspSeverity,
  buildCspHeader,
  isOriginWhitelisted,
} from '../packages/shared/src/schemas/security-csp.schema';
import { buildEdgeCspHeader, mintEdgeNonce } from '../apps/frontend/lib/security/csp-header';
import { ingestCspReport } from '../apps/backend/src/infra/security/csp-report.handler';
import { CorsWhitelistGuard, DEFAULT_WHITELISTED_ORIGINS } from '../apps/backend/src/infra/security/cors-whitelist.guard';
import { mintCspNonce } from '../apps/backend/src/infra/security/csp.middleware';
import { R2_CORS_RULES, R2_SERVED_ORIGINS, loadWhitelistRegistry } from '../apps/backend/src/infra/security/cloudflare-cors.config';

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const NATIVE = {
  'csp-report': {
    'document-uri': 'https://liff.omnichannel.com/catalog',
    'violated-directive': 'media-src',
    'effective-directive': 'media-src',
    'original-policy': "media-src 'self' blob: https://videocdn.omnichannel.com",
    disposition: 'enforce',
    'blocked-uri': 'https://evil.example.com/v.mp4',
    'status-code': 200,
  },
};

const CAMEL = {
  cspReport: {
    documentUri: 'https://liff.omnichannel.com/checkout/pay',
    violatedDirective: 'script-src',
    effectiveDirective: 'script-src',
    originalPolicy: "script-src 'self'",
    disposition: 'enforce',
    blockedUri: 'inline',
    statusCode: 200,
    scriptSample: 'alert(1)',
  },
};

// ---------- 1. Zod vocabulary + native/camel envelopes (§3.1 Gate 1) ----------
{
  assert.equal(NativeCspReportSchema.safeParse(NATIVE['csp-report']).success, true);
  assert.equal(NativeCspReportSchema.safeParse({ ...NATIVE['csp-report'], 'blocked-uri': '' }).success, false);
  // Non-URL blocked values (inline/data:/blob:/eval) MUST validate — real browsers.
  for (const b of ['inline', 'eval', 'data:', 'blob:', 'self']) {
    assert.equal(NativeCspReportSchema.safeParse({ ...NATIVE['csp-report'], 'blocked-uri': b }).success, true);
  }
  assert.equal(CspReportPayloadSchema.safeParse(CAMEL).success, true);
  assert.equal(CspReportPayloadSchema.safeParse({ cspReport: { ...CAMEL.cspReport, effectiveDirective: undefined } }).success, false);
  assert.equal(AnyCspReportEnvelopeSchema.safeParse(NATIVE).success, true);
  assert.equal(AnyCspReportEnvelopeSchema.safeParse(CAMEL).success, true);
  assert.equal(AnyCspReportEnvelopeSchema.safeParse({ nope: 1 }).success, false);

  const goodWhitelist = {
    tenantId: 'default',
    liffAppId: '2000000000-abcDEF12',
    primaryDomain: 'https://liff.omnichannel.com',
    whitelistedDomains: ['https://liff.omnichannel.com'],
    hlsCdnOrigin: 'https://videocdn.omnichannel.com',
    ebookCdnOrigin: 'https://cdn.omnichannel.com',
  };
  assert.equal(DomainWhitelistConfigSchema.safeParse(goodWhitelist).success, true);
  assert.equal(DomainWhitelistConfigSchema.safeParse({ ...goodWhitelist, liffAppId: 'short' }).success, false);
  assert.equal(DomainWhitelistConfigSchema.safeParse({ ...goodWhitelist, whitelistedDomains: [] }).success, false);
  assert.equal(DomainWhitelistConfigSchema.safeParse({ ...goodWhitelist, hlsCdnOrigin: 'not-a-url' }).success, false);

  const token = { videoId: 'vid-1', playbackToken: 'pt', expiresAt: 1700000000, allowedOrigin: 'https://liff.omnichannel.com', signature: 'sig' };
  assert.equal(HlsStreamTokenPayloadSchema.safeParse(token).success, true);
  assert.equal(HlsStreamTokenPayloadSchema.safeParse({ ...token, allowedOrigin: 'line://app/x' }).success, false);

  for (const s of ['INFO', 'WARNING', 'CRITICAL', 'BLOCKED_XSS']) assert.equal(SecuritySeverityEnum.safeParse(s).success, true);
  assert.equal(CspViolationRecordSchema.safeParse({ ...normalizeCspReport(NATIVE)! }).success, true);
  assert.equal(CSP_REPORT_PATH, '/api/security/csp-report');
  assert.equal(CSP_QUEUE, 'security:csp:logs');
  assert.equal(CSP_MAX_BYTES, 65536);
  assert.equal(R2_CORS_MAX_AGE, 3600);
  ok('Zod native/camel envelopes + whitelist/token/severity boundaries + constants');
}

// ---------- 2. normalize + severity classifier ----------
{
  const n = normalizeCspReport(NATIVE)!;
  assert.equal(n.documentUri, 'https://liff.omnichannel.com/catalog');
  assert.equal(n.effectiveDirective, 'media-src');
  assert.equal(n.statusCode, 200);
  assert.equal(classifyCspSeverity(n), 'WARNING');

  const c = normalizeCspReport(CAMEL)!;
  assert.equal(c.blockedUri, 'inline');
  assert.equal(classifyCspSeverity(c), 'BLOCKED_XSS');

  const scriptNoSample = normalizeCspReport({ cspReport: { ...CAMEL.cspReport, blockedUri: 'https://evil.example.com/x.js', scriptSample: undefined } })!;
  assert.equal(classifyCspSeverity(scriptNoSample), 'CRITICAL');

  assert.equal(normalizeCspReport({ garbage: true }), null);
  assert.equal(normalizeCspReport(null), null);
  ok('Normalize both envelopes; WARNING / CRITICAL / BLOCKED_XSS; garbage null');
}

// ---------- 3. Origin whitelist matching (exact + wildcard, case-insensitive) ----------
{
  assert.equal(isOriginWhitelisted('https://liff.omnichannel.com', DEFAULT_WHITELISTED_ORIGINS), true);
  assert.equal(isOriginWhitelisted('https://LIFF.OMNICHANNEL.COM', DEFAULT_WHITELISTED_ORIGINS), true);
  assert.equal(isOriginWhitelisted('https://profile.line-scdn.net', DEFAULT_WHITELISTED_ORIGINS), true);
  assert.equal(isOriginWhitelisted('https://a.line.me', DEFAULT_WHITELISTED_ORIGINS), true);
  assert.equal(isOriginWhitelisted('https://evil.example.com', DEFAULT_WHITELISTED_ORIGINS), false);
  assert.equal(isOriginWhitelisted('https://line-scdn.net.evil.com', DEFAULT_WHITELISTED_ORIGINS), false);
  assert.equal(isOriginWhitelisted('https://line.me.evil.com', DEFAULT_WHITELISTED_ORIGINS), false);
  assert.equal(isOriginWhitelisted('', DEFAULT_WHITELISTED_ORIGINS), false);
  ok('Whitelist exact + wildcard + anti-suffix-spoof guards');
}

// ---------- 4. CSP builder: HLS blob directives + dev flag + edge byte-parity ----------
{
  const prod = buildCspHeader({ nonce: 'N==' });
  for (const d of [
    "media-src 'self' blob: https://videocdn.omnichannel.com",
    "worker-src 'self' blob:",
    "frame-ancestors 'self' https://liff.line.me",
    'report-uri /api/security/csp-report',
    "'nonce-N=='",
    "'strict-dynamic'",
    'upgrade-insecure-requests',
  ]) {
    assert.ok(prod.includes(d), `CSP missing ${d}`);
  }
  assert.ok(!prod.includes('unsafe-eval'), 'prod must not allow unsafe-eval');
  assert.ok(buildCspHeader({ nonce: 'N==', isDev: true }).includes("'unsafe-eval'"));

  // Edge copy byte-parity (same nonce/dev matrix → identical strings).
  for (const opts of [{ nonce: '' }, { nonce: 'abc123==' }, { nonce: 'x', isDev: true }, { nonce: '', isDev: true }]) {
    assert.equal(buildEdgeCspHeader(opts), buildCspHeader(opts), `edge parity failed for ${JSON.stringify(opts)}`);
  }
  const nonces = new Set([mintEdgeNonce(), mintEdgeNonce(), mintEdgeNonce(), mintCspNonce(), mintCspNonce()]);
  assert.equal(nonces.size, 5);
  ok('Builder carries HLS blob + nonce + report-uri; edge byte-parity; nonces unique');
}

async function main(): Promise<void> {
// ---------- 5. Ingestor: native/camel persist, garbage silent, sinks fail-open ----------
{
  const published: Array<{ channel: string; message: string }> = [];
  const created: unknown[] = [];
  const deps = {
    redis: { publish: async (c: string, m: string) => { published.push({ channel: c, message: m }); } },
    prisma: { securityCspLog: { create: async (args: unknown) => { created.push(args); return {}; } } },
  };
  const meta = { ipAddress: '1.2.3.4', userAgent: 'LINE LIFF' };

  const r1 = await ingestCspReport(deps, NATIVE, meta);
  assert.equal(r1.stored, true);
  assert.equal(r1.severity, 'WARNING');
  assert.equal(published[0].channel, 'security:csp:logs');
  const evt = JSON.parse(published[0].message) as { severity: string; ipAddress: string; blockedUri: string };
  assert.equal(evt.severity, 'WARNING');
  assert.equal(evt.ipAddress, '1.2.3.4');
  const row = (created[0] as { data: { documentUri: string; severity: string } }).data;
  assert.equal(row.documentUri, 'https://liff.omnichannel.com/catalog');

  const r2 = await ingestCspReport(deps, CAMEL, meta);
  assert.equal(r2.severity, 'BLOCKED_XSS');

  const before = published.length;
  const r3 = await ingestCspReport(deps, { junk: true }, meta);
  assert.equal(r3.stored, false);
  assert.equal(published.length, before);
  assert.equal(created.length, 2);

  // Total sink outage: still resolves (beacon never 5xxs the browser).
  const warnings: string[] = [];
  const dead = {
    redis: { publish: async () => { throw new Error('redis down'); } },
    prisma: { securityCspLog: { create: async () => { throw new Error('db down'); } } },
    warn: (m: string) => { warnings.push(m); },
  };
  const r4 = await ingestCspReport(dead, NATIVE, meta);
  assert.equal(r4.stored, true);
  assert.equal(warnings.length, 2);
  ok('Ingest persists native/camel + severity; garbage silent; outage fail-open with logs');
}

// ---------- 6. Guard: beacon-friendly pass, declared-origin enforcement ----------
{
  const guard = new CorsWhitelistGuard();
  const ctxOf = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as never;
  assert.equal(guard.canActivate(ctxOf({})), true);
  assert.equal(guard.canActivate(ctxOf({ origin: 'https://liff.omnichannel.com' })), true);
  assert.equal(guard.canActivate(ctxOf({ origin: 'https://profile.line-scdn.net' })), true);
  assert.equal(guard.canActivate(ctxOf({ referer: 'https://liff.omnichannel.com/catalog/ebook-1' })), true);
  assert.throws(() => guard.canActivate(ctxOf({ origin: 'https://evil.example.com' })), /blocked by security policy/);
  assert.throws(() => guard.canActivate(ctxOf({ origin: 'not-a-url-at-all' })), /blocked by security policy/);
  const strict = new CorsWhitelistGuard(['https://liff.omnichannel.com']);
  assert.throws(() => strict.canActivate(ctxOf({ origin: 'https://app.omnichannel.com' })), /blocked by security policy/);
  ok('Guard passes origin-less + whitelisted; 403 evil/garbage; custom list honored');
}

// ---------- 7. R2 CORS: JSON file == compiled rules + registry loader gate ----------
{
  const file = JSON.parse(readFileSync('apps/backend/src/infra/cloudflare/r2-cors-policy.json', 'utf8') as string) as unknown;
  assert.deepEqual(file, R2_CORS_RULES);
  const rule = R2_CORS_RULES[0];
  assert.ok(rule.AllowedOrigins.includes('https://liff.omnichannel.com'));
  assert.deepEqual(rule.AllowedMethods, ['GET', 'HEAD']);
  assert.ok(rule.AllowedHeaders.includes('Range') && rule.ExposeHeaders.includes('Content-Range'));
  assert.equal(rule.MaxAgeSeconds, 3600);
  assert.ok(R2_SERVED_ORIGINS.includes('https://videocdn.omnichannel.com'));

  const registry = loadWhitelistRegistry('apps/backend/src/config/line-developers-whitelist.json');
  assert.equal(registry.length, 1);
  assert.equal(registry[0].tenantId, 'default');
  assert.ok(registry[0].whitelistedDomains.includes('https://videocdn.omnichannel.com'));
  assert.throws(() => loadWhitelistRegistry('package.json'), /Invalid whitelist/);
  ok('R2 CORS file/rules identical; registry loads + validates, rejects bad files');
}

// ---------- 8. Prisma SSOT sync + module wiring + middleware/edge/proxy/fallback ----------
{
  const prisma = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
  for (const t of ['enum SecuritySeverity', 'model SecurityCspLog', 'model DomainWhitelistRegistry', 'BLOCKED_XSS', '@@index([violatedDirective])', '@@index([tenantId])']) {
    assert.ok(prisma.includes(t), `prisma missing ${t}`);
  }
  const secMod = readFileSync('apps/backend/src/infra/security/security.module.ts', 'utf8');
  assert.ok(secMod.includes('CspReportController') && secMod.includes('ContentSecurityPolicyMiddleware') && secMod.includes('CorsWhitelistGuard'));
  const app = readFileSync('apps/backend/src/app.module.ts', 'utf8');
  assert.ok(app.includes('SecurityModule'));
  const alias = readFileSync('apps/backend/src/api/controllers/csp-report.controller.ts', 'utf8');
  assert.ok(alias.includes("from '../../infra/security/csp-report.controller'"));

  const mw = readFileSync('apps/frontend/middleware.ts', 'utf8');
  for (const marker of ['Content-Security-Policy', 'X-CSP-Nonce', 'mintEdgeNonce', 'applyCsp', "'/api/security/csp-report'", 'x-csp-nonce']) {
    assert.ok(mw.includes(marker), `middleware missing ${marker}`);
  }
  // CSP applied on every edge return path (resolver/resolve/public/401/redirect/authed).
  const applyCount = (mw.match(/applyCsp\(/g) ?? []).length;
  assert.ok(applyCount >= 7, `expected CSP on all return paths, found ${applyCount}`);
  assert.ok(!mw.includes("from '@repo/shared'"), 'edge stays zod-free: no shared import');

  const proxy = readFileSync('apps/frontend/app/api/security/csp-report/route.ts', 'utf8');
  assert.ok(proxy.includes('/api/v1/security/csp-report') && proxy.includes('204'));
  // Fastify parses only JSON content types — the proxy must forward as
  // application/json or reports arrive as undefined (silent pipeline loss).
  assert.ok(proxy.includes("'Content-Type': 'application/json'"), 'proxy must forward JSON content type');

  const fallback = readFileSync('apps/frontend/components/player/HlsSecurityFallback.tsx', 'utf8');
  for (const marker of ['การเชื่อมต่อไม่ปลอดภัย', 'โดนระงับการเข้าถึงสื่อ', 'โดเมนไม่ได้รับอนุญาต', 'ลองโหลดใหม่', "'CSP'", "'CORS'", "'ORIGIN'"]) {
    assert.ok(fallback.includes(marker), `fallback missing ${marker}`);
  }
  assert.ok(!fallback.includes("from 'lucide") && !fallback.includes('from "lucide'), 'zero new deps: no lucide import');
  ok('Prisma/GQL-gate parity; SecurityModule wired; edge CSP all-paths + zod-free; proxy 204; HLS fallback copy');
}

console.log(`\nPhase 028 contracts: ${passed} checks passed`);
}

void main();
