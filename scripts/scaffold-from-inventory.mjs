#!/usr/bin/env node
/**
 * scaffold-from-inventory.mjs — Phase 000 generator
 * Reads filefolder.md (inventory table) + schema.md (prisma blocks)
 * Creates folders/files per canonical Turborepo paths + builds full prisma schema.
 *
 * Usage:
 *   node scripts/scaffold-from-inventory.mjs [--full-schema] [--force] [--limit=N]
 * Defaults: scaffold all dirs+files (skip existing), always build schema.full.prisma + report.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(=(.*))?$/);
    return m ? [m[1], m[3] ?? true] : [a, true];
  }),
);
const FORCE = args.force === true || args.force === 'true';
const LIMIT = args.limit ? Number(args.limit) : Infinity;

// Files that are SSOT hand-written in Phase 0 — never overwrite unless --force
const PROTECTED = new Set([
  'packages/db/prisma/schema.prisma',
  'packages/shared/src/schemas/sdid-contract.ts',
  '.rule',
  '.devinrule',
  'skill.md',
  'agent.md',
  'memory.md',
  'index.md',
  'context.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
  'docker-compose.yml',
  '.env.example',
  'docs/phase-roadmap-130.md',
]);

function parseInventory(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    // | folder | `canonical` | type | phase | note |
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length < 6) continue;
    const canonRaw = cols[2];
    const kind = cols[3];
    const phase = cols[4];
    const note = cols[5];
    if (!canonRaw.startsWith('`') || canonRaw === '`ไฟล์ / พาธเต็ม (canonical)`') continue;
    const canonical = canonRaw.replace(/`/g, '').trim();
    if (!canonical || canonical.includes('**') || canonical.includes('*')) continue;
    if (kind !== 'file' && kind !== 'dir') continue;
    // Skip garbage parse artifacts like `...(1`, `...* )`
    if (/[()*]/.test(canonical)) {
      rows.push({ canonical, kind, phase, note, skipped: 'garbage-chars' });
      continue;
    }
    rows.push({ canonical, kind, phase, note });
  }
  return rows;
}

function templateFor(canonical, phase, note) {
  const header = `/**\n * AUTO-SCAFFOLD Phase ${phase} — ${note || 'placeholder'}\n * SSOT: schema.md + filefolder.md | RAM<30MB | slip<1s | R2 zero-egress\n * TODO: implement per Phases/phase_*.md (schema-first, zod-validated)\n */\n`;
  if (canonical.endsWith('.resolver.ts'))
    return `${header}import { Resolver, Query } from '@nestjs/graphql';\n@Resolver()\nexport class ${className(canonical)} {\n  @Query(() => String)\n  health(): string { return 'ok'; }\n}\n`;
  if (canonical.endsWith('.service.ts'))
    return `${header}import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class ${className(canonical)} {}\n`;
  if (canonical.endsWith('.module.ts'))
    return `${header}import { Module } from '@nestjs/common';\n@Module({})\nexport class ${className(canonical)} {}\n`;
  if (canonical.endsWith('.controller.ts'))
    return `${header}import { Controller, Get } from '@nestjs/common';\n@Controller()\nexport class ${className(canonical)} {\n  @Get('health') health() { return { ok: true }; }\n}\n`;
  if (canonical.endsWith('.guard.ts'))
    return `${header}import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';\n@Injectable()\nexport class ${className(canonical)} implements CanActivate {\n  canActivate(_ctx: ExecutionContext): boolean { return true; }\n}\n`;
  if (canonical.endsWith('.dto.ts'))
    return `${header}import { z } from 'zod';\nexport const DtoSchema = z.object({});\nexport type Dto = z.infer<typeof DtoSchema>;\n`;
  if (canonical.endsWith('.graphql'))
    return `# AUTO-SCAFFOLD Phase ${phase}\ntype Query {\n  _health: String\n}\n`;
  if (canonical.endsWith('.json')) return '{}\n';
  if (canonical.endsWith('.sh')) return '#!/bin/sh\n# AUTO-SCAFFOLD Phase ' + phase + '\n';
  if (canonical.endsWith('.sql')) return '-- AUTO-SCAFFOLD Phase ' + phase + '\n';
  if (canonical.endsWith('.tsx') || canonical.endsWith('.ts')) {
    // Lightweight LIFF-safe placeholder (no heavy deps)
    if (canonical.includes('apps/frontend'))
      return `${header}export default function Placeholder() { return null; }\n`;
    return `${header}export const placeholder = true;\n`;
  }
  return `${header}// placeholder\n`;
}

function className(p) {
  const base = path.basename(p).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  const pascal = base.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return (pascal || 'Auto') + (p.endsWith('.resolver.ts') ? 'Resolver' : p.endsWith('.service.ts') ? 'Service' : p.endsWith('.module.ts') ? 'Module' : p.endsWith('.controller.ts') ? 'Controller' : p.endsWith('.guard.ts') ? 'Guard' : 'Placeholder');
}

function ensureFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(filePath) && !FORCE && PROTECTED.has(path.relative(ROOT, filePath).replace(/\\/g, '/'))) {
    return 'protected-skip';
  }
  if (fs.existsSync(filePath) && !FORCE) return 'exists-skip';
  fs.writeFileSync(filePath, content);
  return 'created';
}

// ---- schema.md -> full prisma ----
function parsePrismaBlocks(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const blocks = [...text.matchAll(/```prisma([\s\S]*?)```/g)].map((m) => m[1].trim());
  const enums = new Map(); // name -> {body longest, phases:Set}
  const models = new Map();
  let header = '';
  for (const b of blocks) {
    if (/datasource\s+db/.test(b)) {
      header = b;
      continue;
    }
    const enumM = b.match(/enum\s+(\w+)\s*\{([\s\S]*?)\}/);
    // A block may contain exactly one enum or model per schema.md layout
    const enumName = b.match(/^\s*enum\s+(\w+)/m)?.[1];
    const modelName = b.match(/^\s*model\s+(\w+)/m)?.[1] || b.match(/model\s+(\w+)/)?.[1];
    if (enumName && !modelName) {
      const prev = enums.get(enumName);
      const srcPhase = (b.match(/Source: Atomic Phase ([\d,\s]+)/) || [])[1] || '';
      if (!prev || b.length > prev.body.length) enums.set(enumName, { body: b, phases: new Set([...(prev?.phases ?? []), srcPhase]) });
      else if (srcPhase) srcPhase.split(',').forEach((p) => prev.phases.add(p.trim()));
      continue;
    }
    if (modelName && !enumName) {
      const prev = models.get(modelName);
      const srcPhase = (b.match(/Source: Atomic Phase ([\d,\s]+)/) || [])[1] || '';
      if (!prev || b.length > prev.body.length) models.set(modelName, { body: b, phases: new Set([...(prev?.phases ?? []), srcPhase]) });
      else if (srcPhase) srcPhase.split(',').forEach((p) => prev.phases.add(p.trim()));
      continue;
    }
    void enumM;
  }
  return { header, enums, models };
}

function buildFullSchema(header, enums, models) {
  const ds = header || 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n\ngenerator client {\n  provider = "prisma-client-js"\n  previewFeatures = ["postgresqlExtensions"]\n}';
  const enumNames = [...enums.keys()].sort();
  const modelNames = [...models.keys()].sort();
  let out = `// GENERATED from schema.md — DO NOT EDIT. Edit schema.md then re-run scaffold.\n// Enums: ${enumNames.length}, Models: ${modelNames.length}\n${ds}\n`;
  for (const n of enumNames) out += `\n// Phases: ${[...enums.get(n).phases].filter(Boolean).join(', ')}\n${enums.get(n).body}\n`;
  for (const n of modelNames) out += `\n// Phases: ${[...models.get(n).phases].filter(Boolean).join(', ')}\n${models.get(n).body}\n`;
  return { out, enumNames, modelNames };
}

// ---- main ----
const invPath = path.join(ROOT, 'filefolder.md');
const schemaPath = path.join(ROOT, 'schema.md');
if (!fs.existsSync(invPath) || !fs.existsSync(schemaPath)) {
  console.error('Missing filefolder.md or schema.md in cwd:', ROOT);
  process.exit(1);
}

const rows = parseInventory(invPath);
const stats = { dir: 0, fileCreated: 0, fileSkip: 0, garbage: 0 };
let n = 0;
for (const r of rows) {
  if (n++ >= LIMIT) break;
  if (r.skipped) {
    stats.garbage++;
    continue;
  }
  const abs = path.join(ROOT, r.canonical);
  if (r.kind === 'dir') {
    try {
      const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
      if (st && st.isFile()) { stats.garbage++; continue; } // inventory noise: dir flag on real file
      fs.mkdirSync(abs, { recursive: true });
      stats.dir++;
    } catch (e) {
      if (e && e.code === 'EEXIST') { stats.garbage++; continue; }
      throw e;
    }
  } else {
    const res = ensureFile(abs, templateFor(r.canonical, r.phase, r.note));
    if (res === 'created') stats.fileCreated++;
    else stats.fileSkip++;
  }
}

const { header, enums, models } = parsePrismaBlocks(schemaPath);
const { out, enumNames, modelNames } = buildFullSchema(header, enums, models);
const fullPath = path.join(ROOT, 'packages/db/prisma/schema.full.prisma');
fs.mkdirSync(path.dirname(fullPath), { recursive: true });
fs.writeFileSync(fullPath, out);

const report = {
  inventoryRows: rows.length,
  dirsEnsured: stats.dir,
  filesCreated: stats.fileCreated,
  filesSkippedExisting: stats.fileSkip,
  garbageSkipped: stats.garbage,
  schemaEnums: enumNames.length,
  schemaModels: modelNames.length,
  fullSchemaPath: 'packages/db/prisma/schema.full.prisma',
  fullSchemaNote: 'raw consolidation needs opposite-relation fix; auto-running scripts/fix-full-schema.mjs',
};
const reportPath = path.join(ROOT, 'docs/scaffold-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

// Auto-fix opposite relations so the generated full schema stays `prisma validate`-clean.
try {
  const { execSync } = await import('node:child_process');
  execSync('node scripts/fix-full-schema.mjs --rounds=6', { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error('full-schema auto-fix failed (raw file kept):', e?.message ?? e);
}

console.log(JSON.stringify(report, null, 2));
console.log('Phase 0 scaffold done. Next: pnpm install && prisma validate (full file may need opposite-relation fixes per schema.md note).');
