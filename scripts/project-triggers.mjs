#!/usr/bin/env node
/**
 * project-triggers.mjs — derive triggers.json's PHRASE vocabulary from the
 * canonical model (../dgmo-content/registry.json), closing the "one vocabulary"
 * loop (docs/registry-entity-model.md). The MCP was the vocabulary SOURCE; now
 * it CONSUMES the shared keyword field the same way new-file search + docs do.
 *
 * Split of concerns (per the design's DESCRIPTIVE vs TUNING line):
 *   • phrases   ← registry type-entity keywords         (DESCRIPTIVE — the model owns)
 *   • concepts  ← preserved from triggers.json           (MCP authoring hints)
 *   • prior     ← preserved from triggers.json           (TUNING — MCP owns)
 *
 * The scorer still reads triggers.json unchanged; only where the phrases come
 * FROM moves to the model. Clone-and-replace preserves each entry's exact key
 * shape (many entries omit `prior`) so a projection of an in-sync pair is
 * byte-identical.
 *
 *   (default)  rewrite src/suggest/triggers.json from registry.json
 *   --check    exit 1 if triggers.json differs from the projection (CI drift guard)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(HERE, '..');
const TRIGGERS = join(MCP_ROOT, 'src/suggest/triggers.json');
const REGISTRY = join(MCP_ROOT, '../dgmo-content/registry.json');
const CHECK = process.argv.includes('--check');

const registry = JSON.parse(await readFile(REGISTRY, 'utf8'));
const current = await readFile(TRIGGERS, 'utf8');
const triggers = JSON.parse(current);

// type entity id → its keyword phrase list (the shared vocabulary)
const phrasesByType = new Map(
  registry.entities.filter((e) => e.kind === 'type').map((e) => [e.id, e.keywords.map((k) => k.text)])
);

// Rebuild each entry: clone (preserves concepts + optional prior + key order),
// overwrite phrases from the model. Types absent from the registry keep theirs.
const out = {};
for (const [id, entry] of Object.entries(triggers)) {
  const projected = phrasesByType.get(id);
  out[id] = { ...entry, phrases: projected ?? entry.phrases };
}

const text = JSON.stringify(out, null, 2) + '\n';

// report any type the registry knows that triggers.json doesn't (selection needs it)
const missing = [...phrasesByType.keys()].filter((id) => !(id in triggers));

if (CHECK) {
  if (text === current) {
    console.log('✓ triggers.json phrases in sync with registry.json');
    process.exit(0);
  }
  console.error('✗ triggers.json is STALE — run: node scripts/project-triggers.mjs');
  if (missing.length) console.error(`  registry types missing a triggers entry: ${missing.join(', ')}`);
  process.exit(1);
}

await writeFile(TRIGGERS, text, 'utf8');
const changed = text !== current;
console.log(`triggers.json projected from registry: ${Object.keys(out).length} types${changed ? '' : ' (no change — already in sync)'}`);
if (missing.length) console.log(`  note: registry types with no triggers entry: ${missing.join(', ')}`);
