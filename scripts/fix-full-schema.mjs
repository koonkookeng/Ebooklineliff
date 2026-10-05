#!/usr/bin/env node
/**
 * fix-full-schema.mjs — auto-add missing opposite relation fields in schema.full.prisma
 * Iterates: parse models -> for each forward relation without counterpart, add it.
 * Run repeatedly until `prisma validate` is clean (max --rounds).
 * Usage: node scripts/fix-full-schema.mjs [--rounds=10] [--schema=packages/db/prisma/schema.full.prisma]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(=(.*))?$/);
    return m ? [m[1], m[3] ?? true] : [a, true];
  }),
);
const ROUNDS = Number(args.rounds ?? 10);
const SCHEMA = path.join(process.cwd(), String(args.schema ?? 'packages/db/prisma/schema.full.prisma'));

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
  'Unsupported',
]);

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (s) => {
  if (s.endsWith('s')) return s + 'es';
  if (s.endsWith('y')) return s.slice(0, -1) + 'ies';
  return s + 's';
};

function parseSchema(text) {
  const enums = new Set([...text.matchAll(/^\s*enum\s+(\w+)/gm)].map((m) => m[1]));
  const models = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    models.set(m[1], { name: m[1], body: m[2], start: m.index, end: m.index + m[0].length, full: m[0] });
  }
  return { enums, models };
}

function parseFields(modelBody) {
  const fields = [];
  for (const line of modelBody.split('\n')) {
    const fm = line.match(/^\s*(\w+)\s+([\w\[\]?]+)\s*(.*?)\s*$/);
    if (!fm) continue;
    const [, fname, ftype, attrs] = fm;
    if (fname.startsWith('@@')) continue;
    fields.push({ fname, ftype, attrs: attrs.trim(), line });
  }
  return fields;
}

const baseType = (t) => t.replace(/\[\]/g, '').replace(/\?$/g, '');
const isList = (t) => t.includes('[]');
const relName = (attrs) => (attrs.match(/@relation\(\s*"([^"]+)"/) || [])[1] ?? null;

function fixOnce(text) {
  const { enums, models } = parseSchema(text);
  const modelNames = new Set(models.keys());
  const isModel = (t) => modelNames.has(t) && !SCALARS.has(t) && !enums.has(t);

  // Index existing relation linkages per pair
  const additions = []; // {target, lines[]}
  const addTo = (target, line) => {
    const a = additions.find((x) => x.target === target);
    if (a) a.lines.push(line);
    else additions.push({ target, lines: [line] });
  };
  let added = 0;

  for (const [sName, sModel] of models) {
    const sFields = parseFields(sModel.body);
    const sFieldNames = new Set(sFields.map((f) => f.fname));
    for (const f of sFields) {
      const bt = baseType(f.ftype);
      if (!isModel(bt)) continue;
      if (bt === sName) continue; // self-relation: leave to validator
      const tModel = models.get(bt);
      if (!tModel) continue;
      const tFields = parseFields(tModel.body);
      const name = relName(f.attrs);
      // counterpart exists? same target type + (same relation name if named)
      const hasCounterpart = tFields.some((tf) => {
        if (baseType(tf.ftype) !== sName) return false;
        if (name) return relName(tf.attrs) === name;
        return true;
      });
      if (hasCounterpart) continue;

      if (isList(f.ftype)) {
        // A.list[] -> B : B needs many-to-one back to A
        let fname = lowerFirst(sName);
        let i = 1;
        const taken = new Set([...tFields.map((x) => x.fname), ...((additions.find((x) => x.target === bt) || {}).lines || []).map((l) => l.match(/^\s*(\w+)/)?.[1])]);
        while (taken.has(fname)) fname = `${lowerFirst(sName)}${++i}`;
        let fk = `${fname}Id`;
        const fkExists = tFields.some((x) => x.fname === fk);
        const tag = name ? `"${name}", ` : '';
        const lines = [];
        if (!fkExists) lines.push(`  ${fk} String`);
        lines.push(`  ${fname} ${sName} @relation(${tag}fields: [${fk}], references: [id], onDelete: Cascade)`);
        addTo(bt, lines.join('\n'));
        added++;
      } else {
        // A.f -> B (many-to-one) : B needs list back
        const taken = new Set([...tFields.map((x) => x.fname)]);
        for (const a of additions.filter((x) => x.target === bt)) {
          for (const l of a.lines) {
            const mm = l.match(/^\s*(\w+)/);
            if (mm) taken.add(mm[1]);
          }
        }
        let lname = plural(lowerFirst(sName));
        if (lname === f.fname || taken.has(lname)) {
          // disambiguate with forward field name, e.g. matchedOrder -> matchedOrderBankStatements
          const cap = f.fname.charAt(0).toUpperCase() + f.fname.slice(1);
          lname = `${f.fname}${cap.endsWith('s') ? '' : ''}`;
          lname = f.fname === lowerFirst(bt) ? `${lowerFirst(sName)}${cap}` : `${lowerFirst(sName)}By${cap}`;
          let j = 1;
          while (taken.has(lname)) lname = `${lowerFirst(sName)}By${cap}${++j}`;
        }
        const tag = name ? `("${name}")` : '';
        addTo(bt, `  ${lname} ${sName}[]${tag ? ` @relation${tag}` : ''}`);
        added++;
      }
    }
  }

  if (added === 0) return { text, added };

  let out = text;
  // Apply additions bottom-up by model position to keep offsets valid
  const { models: m2 } = parseSchema(out);
  const ordered = additions
    .map((a) => ({ ...a, idx: m2.get(a.target)?.end ?? -1 }))
    .filter((a) => a.idx > 0)
    .sort((x, y) => y.idx - x.idx);
  for (const a of ordered) {
    // insert before closing brace of target model: find last '\n}' of its block
    const model = m2.get(a.target);
    const closeIdx = model.end - 1; // position of '}'
    const inject = a.lines.join('\n') + '\n';
    out = out.slice(0, closeIdx) + inject + out.slice(closeIdx);
    // re-parse for next insertion offsets
    const reparsed = parseSchema(out);
    m2.clear();
    for (const [k, v] of reparsed.models) m2.set(k, v);
  }
  return { text: out, added };
}

let text = fs.readFileSync(SCHEMA, 'utf8');
for (let r = 1; r <= ROUNDS; r++) {
  const { text: next, added } = fixOnce(text);
  console.log(`round ${r}: +${added} opposite fields`);
  text = next;
  if (added === 0) break;
}
fs.writeFileSync(SCHEMA, text);
console.log('wrote', SCHEMA);
