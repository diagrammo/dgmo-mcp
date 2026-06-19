// Unified dev-tools hub. ONE Vite server, ONE port, ONE browser tab — a tabbed
// shell (index.html) that switches between the three dgmo-mcp dev tools:
//   • Trigger tuning   → selection-harness/index.html  (phrase/vocab scoring)
//   • LLM judge        → selection-harness/judge.html   (description judging)
//   • Guidance studio  → guidance-studio/index.html     (per-type TIPS authoring)
//
// Both tools' dev-server middlewares are registered here. Their endpoints don't
// collide: the selection-harness owns /data,/descriptions,/judge,/save,
// /save-descriptions,/run; the guidance studio is namespaced under /studio/*.
//
// Run with `pnpm hub` (dumps both registries + builds dist for the studio's
// render path, then starts this server). The old `pnpm harness` / `pnpm studio`
// still work standalone if ever needed.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { savePlugin as selectionSavePlugin } from './selection-harness/save-plugin';
import { savePlugin as studioSavePlugin } from './guidance-studio/save-plugin';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  resolve: {
    alias: {
      // selection-harness's scoring.ts imports the non-bundleable render barrel;
      // redirect it to the browser-safe registry shim (Task-0 spike).
      '@diagrammo/dgmo/internal': path.join(
        here,
        'selection-harness/registry-shim.ts'
      ),
    },
  },
  server: {
    // Source files the middlewares write back to — don't watch them, or a Save
    // triggers a full reload that wipes in-memory edit/run state. Each handler
    // re-reads from disk per request, so no reload is needed.
    watch: {
      ignored: [
        path.join(here, 'selection-harness/../../src/suggest/triggers.json'),
        path.join(here, 'selection-harness/../../tests/fixtures/selection-corpus.json'),
        path.join(here, '../../dgmo/docs/language-reference.md'),
      ],
    },
  },
  plugins: [selectionSavePlugin(), studioSavePlugin()],
});
