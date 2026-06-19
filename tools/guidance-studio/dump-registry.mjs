// Prebuild snapshot for the guidance studio: dump the chart-type registry +
// the current TIPS coverage of the dgmo SOURCE language-reference.md into a
// small registry.json the browser imports for its initial render. Coverage is
// also served live via GET /coverage (fresh from disk) after each save — this
// snapshot just seeds the first paint. Re-runs every `pnpm studio`.
//
// Node CAN import the advanced barrel (only the browser bundle can't), so this
// runs from the package root before vite starts (mirrors selection-harness).
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chartTypes } from '@diagrammo/dgmo/advanced';

const here = path.dirname(fileURLToPath(import.meta.url));

// The AUTHORING target is the workspace dgmo source (not the installed package),
// because edits are written back here. Studio is a workspace dev tool.
const REF_PATH = path.join(here, '../../../dgmo/docs/language-reference.md');
const md = readFileSync(REF_PATH, 'utf8');

const descById = new Map(chartTypes.map((c) => [c.id, c.description]));

// Scan the 35 raw `<!-- TYPE:id -->` blocks (the coverage unit) for a TIPS pair.
const TIPS_RE = /<!--\s*TIPS start\s*-->[\s\S]*?<!--\s*TIPS end\s*-->/;
const markerRe = /<!--\s*TYPE:([a-z0-9-]+)\s*-->/g;
const markers = [];
let m;
while ((m = markerRe.exec(md))) markers.push({ id: m[1], end: m.index + m[0].length });

const types = markers.map((mk, i) => {
  const start = mk.end;
  const rest = md.slice(start);
  const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
  const nextH2 = rest.search(/^## /m);
  const ends = [nextType, nextH2].filter((n) => n !== -1);
  const blockEnd = ends.length ? start + Math.min(...ends) : md.length;
  const block = md.slice(start, blockEnd);
  return {
    id: mk.id,
    description: descById.get(mk.id) ?? '',
    hasTips: TIPS_RE.test(block),
  };
});

writeFileSync(
  path.join(here, 'registry.json'),
  JSON.stringify({ types }, null, 2) + '\n'
);
const withTips = types.filter((t) => t.hasTips).length;
console.log(
  `[studio] dumped ${types.length} TYPE blocks (${withTips} with tips) → registry.json`
);
