// SSOT Phase 029 Task 3/§10.1 — CI bundle guard (heavy deps + 2MB initial ceiling)
// - Check 1 (legacy): no heavy LIFF deps in frontend sources (RAM proxy).
// - Check 2 (Phase 029 BDD Scenario 1): total initial JS+CSS under 2MB
//   (BUNDLE_MAX_BYTES). Reads apps/frontend/.next/build-manifest.json; when no
//   production build exists locally it SKIPS check 2 (exit 0) — CI runs this
//   after `next build`, so the gate still fails the pipeline on violation.
// - Pure verifyBundleGuard() is unit-tested in test-phase029-contracts.ts.
import fs from 'node:fs';
import path from 'node:path';

const heavy = ['three', 'fabric', 'pdfjs-dist', 'video.js'];
const dir = 'apps/frontend';
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export interface BundleGuardVerdict {
  totalBytes: number;
  passed: boolean;
  checkedFiles: number;
}

export function verifyBundleGuard(buildDir: string, manifestRel = 'build-manifest.json'): BundleGuardVerdict | null {
  const manifestPath = path.join(buildDir, manifestRel);
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { pages?: Record<string, string[]> };
  const initialFiles: string[] = manifest.pages?.['/'] ?? [];
  let total = 0;
  let checked = 0;
  for (const file of initialFiles) {
    const filePath = path.join(buildDir, file);
    if (fs.existsSync(filePath)) {
      total += fs.statSync(filePath).size;
      checked++;
    }
  }
  return { totalBytes: total, passed: total <= MAX_BUNDLE_BYTES, checkedFiles: checked };
}

let bad: string[] = [];
function walk(d: string) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      const t = fs.readFileSync(p, 'utf8');
      for (const h of heavy) if (t.includes(`from '${h}'`) || t.includes(`from "${h}"`)) bad.push(`${p} imports ${h}`);
    }
  }
}
walk(dir);
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('Bundle guard PASS (no heavy LIFF deps)');

const verdict = verifyBundleGuard(path.join(process.cwd(), 'apps/frontend/.next'));
if (!verdict) {
  console.log('[Performance Guard] No production build found — skipping 2MB check (CI runs post-build).');
} else {
  console.log(`[Performance Guard] Initial bundle: ${(verdict.totalBytes / 1024 / 1024).toFixed(2)} MB across ${verdict.checkedFiles} files`);
  if (!verdict.passed) {
    console.error(`[GUARD FAILED] Bundle exceeds 2MB (${verdict.totalBytes} bytes) — failing pipeline.`);
    process.exit(1);
  }
  console.log('[GUARD PASSED] Initial bundle strictly within < 2MB.');
}
