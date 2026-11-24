#!/usr/bin/env node
/**
 * project-families.mjs — copy the chart-type families out of the canonical
 * model (../dgmo-content/registry.json) into src/chart-families.json, so
 * `list_chart_types` groups types the way the app's picker and the docs do
 * (diagrammo/diagrammo#1970). Same shape of tool as project-triggers.mjs:
 * dgmo-content is a private workspace sibling the published server cannot
 * reach, so the projection is committed and checked for drift.
 *
 * What it keeps:
 *   • families  ← registry `families`: id, label, and `subheads` (id, label,
 *                 intents) where the family has them — order preserved
 *   • types     ← each type entity's family and FIRST intent; a type sits
 *                 under the sub-head whose intents hold that first intent
 *
 *   (default)  rewrite src/chart-families.json from registry.json
 *   --check    exit 1 if chart-families.json differs from the projection
 *
 * Both modes exit 1 when a registry type has no family, or names a family the
 * registry does not define: list_chart_types would drop it from every group
 * (diagrammo/diagrammo#2288). The fix belongs in registry.json, not here.
 *
 *   --registry <path>  read this registry.json instead (tests)
 *   --out <path>       read and write this chart-families.json instead (tests)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(HERE, '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const OUT = arg('--out') ?? join(MCP_ROOT, 'src/chart-families.json');
const REGISTRY =
  arg('--registry') ?? join(MCP_ROOT, '../dgmo-content/registry.json');
const CHECK = process.argv.includes('--check');

const registry = JSON.parse(await readFile(REGISTRY, 'utf8'));

const families = registry.families.map((f) => ({
  id: f.id,
  label: f.label,
  ...(f.subheads?.length
    ? {
        subheads: f.subheads.map((s) => ({
          id: s.id,
          label: s.label,
          intents: s.intents,
        })),
      }
    : {}),
}));

const types = {};
for (const e of registry.entities) {
  if (e.kind !== 'type') continue;
  types[e.id] = { family: e.family, intent: e.intent?.[0] ?? null };
}

const familyIds = new Set(families.map((f) => f.id));
const orphans = Object.entries(types)
  .filter(([, t]) => !familyIds.has(t.family))
  .map(([id, t]) => `${id} (family: ${t.family ?? 'none'})`);
if (orphans.length) {
  console.error(
    `✗ registry types with no known family (list_chart_types would drop them): ${orphans.join(', ')}`
  );
  console.error('  fix: give each a family defined in registry.json');
  process.exit(1);
}

const projected = { families, types };
const text = await format(JSON.stringify(projected, null, 2), {
  ...(await resolveConfig(OUT)),
  filepath: OUT,
});

let current = '';
try {
  current = await readFile(OUT, 'utf8');
} catch {
  // first run: no file yet
}

if (CHECK) {
  if (text === current) {
    console.log('✓ chart-families.json in sync with registry.json');
    process.exit(0);
  }
  console.error(
    '✗ chart-families.json is STALE — run: node scripts/project-families.mjs'
  );
  process.exit(1);
}

await writeFile(OUT, text, 'utf8');
console.log(
  `chart-families.json projected from registry: ${families.length} families, ${Object.keys(types).length} types${text === current ? ' (no change — already in sync)' : ''}`
);
