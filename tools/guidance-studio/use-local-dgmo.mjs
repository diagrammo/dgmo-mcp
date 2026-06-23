// ============================================================
// use-local-dgmo.mjs — point this repo's @diagrammo/dgmo at the sibling
// ../dgmo workspace checkout so the Guidance Studio renders with your LOCAL
// dgmo build instead of the published npm version.
//
// Why a symlink swap (not a package.json `link:` override): CI runs
// `pnpm install --frozen-lockfile` with only dgmo-mcp checked out, so a
// committed override pointing at ../dgmo would fail the install. This only
// touches node_modules (gitignored) and only when you run `pnpm studio`,
// so CI is never affected.
//
// Self-healing: a later `pnpm install` restores the npm version. To undo
// manually, just run `pnpm install`.
//
// Idempotent: re-running when already linked is a no-op.
// ============================================================
import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = resolve(here, '..', '..'); // tools/guidance-studio → repo root
const dgmoSrc = resolve(mcpRoot, '..', 'dgmo'); // sibling workspace checkout
const linkPath = join(mcpRoot, 'node_modules', '@diagrammo', 'dgmo');

if (!existsSync(join(dgmoSrc, 'package.json'))) {
  console.error(`✗ sibling dgmo not found at ${dgmoSrc} — is the workspace laid out as expected?`);
  process.exit(1);
}
if (!existsSync(join(dgmoSrc, 'dist', 'advanced.cjs'))) {
  console.error(`✗ ${dgmoSrc}/dist is missing — build dgmo first (\`pnpm -C ../dgmo build\`).`);
  process.exit(1);
}

// Already pointing at the local checkout? Nothing to do.
if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
  const current = resolve(dirname(linkPath), readlinkSync(linkPath));
  if (current === dgmoSrc) {
    console.log(`✓ @diagrammo/dgmo already linked → ${dgmoSrc}`);
    process.exit(0);
  }
}

mkdirSync(dirname(linkPath), { recursive: true });
rmSync(linkPath, { recursive: true, force: true });
symlinkSync(dgmoSrc, linkPath, 'dir');
console.log(`✓ linked @diagrammo/dgmo → ${dgmoSrc} (run \`pnpm install\` to revert to npm)`);
