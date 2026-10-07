// SSOT Phase 028 §10.1 — live security-header audit (CSP + HLS whitelist)
// Run: FRONTEND_URL=https://liff.omnichannel.com npx tsx test/csp-whitelisting.spec.ts
// - Self-healing loop hook (§10): if the HLS player is blocked by a Blob CSP
//   violation, update media-src/worker-src (shared builder + edge copy) and
//   re-run this audit 3x before sign-off.
// - Skips gracefully when no live server is reachable (contract suite in
//   scripts/test-phase028-contracts.ts covers logic without network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.FRONTEND_URL ?? 'http://localhost:3000';

async function reachable(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await fetch(`${BASE}/`, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

void describe('Phase 028 live CSP audit', async () => {
  if (!(await reachable())) {
    console.log('(skip) no live frontend at FRONTEND_URL — run contract suite instead');
    return;
  }

  await it('CSP headers carry strict media-src + LINE whitelist + report-uri', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'missing content-security-policy header');
    assert.ok(csp.includes("media-src 'self' blob: https://videocdn.omnichannel.com"));
    assert.ok(csp.includes("frame-ancestors 'self' https://liff.line.me"));
    assert.ok(csp.includes('report-uri /api/security/csp-report'));
    assert.ok(csp.includes('worker-src \'self\' blob:'));
  });

  await it('CSP report beacon answers 204 without auth', async () => {
    const res = await fetch(`${BASE}/api/security/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'document-uri': `${BASE}/audit-probe`,
          'violated-directive': 'media-src',
          'original-policy': "media-src 'self'",
          'blocked-uri': 'https://evil.example.com/v.mp4',
          'status-code': 200,
        },
      }),
    });
    assert.equal(res.status, 204);
  });
});
