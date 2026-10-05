// LIFF bundle guard: frontend reader/player must stay light (<30MB RAM => small bundle proxy: no heavy deps)
import fs from 'node:fs';
import path from 'node:path';
const heavy = ['three', 'fabric', 'pdfjs-dist', 'video.js'];
const dir = 'apps/frontend';
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
