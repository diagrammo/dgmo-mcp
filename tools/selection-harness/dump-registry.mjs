// Dump the chart-type REGISTRY from the installed @diagrammo/dgmo into a small
// browser-safe registry.json that registry-shim.ts re-exports. Node CAN import
// the internal barrel (only the browser bundle can't), so this runs from the
// dgmo-mcp package root before vite starts. Re-runs every `pnpm harness` so the
// snapshot tracks the installed library and never drifts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chartTypes } from '@diagrammo/dgmo/internal';

const here = path.dirname(fileURLToPath(import.meta.url));
const slim = chartTypes.map((c) => ({
  id: c.id,
  description: c.description,
  ...(c.fallback ? { fallback: true } : {}),
}));
writeFileSync(
  path.join(here, 'registry.json'),
  JSON.stringify(slim, null, 2) + '\n'
);
console.log(`[harness] dumped ${slim.length} chart types → registry.json`);
