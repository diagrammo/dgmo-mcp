import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { savePlugin } from './save-plugin';

const here = path.dirname(fileURLToPath(import.meta.url));

// Redirect the scorer's `@diagrammo/dgmo/internal` import (the full, non-
// bundleable render barrel) to the browser-safe registry shim. The REAL
// scoring.ts is bundled unchanged — only its registry source is swapped, and
// registry.json is freshly dumped each run, so there is no code duplication and
// no drift. (Task-0 spike: the direct barrel import fails to bundle.)
export default defineConfig({
  root: here,
  resolve: {
    alias: {
      '@diagrammo/dgmo/internal': path.join(here, 'registry-shim.ts'),
    },
  },
  // Save writes triggers.json + the corpus (both imported by the app). Don't
  // watch them, or every Save triggers a full page reload that wipes the
  // in-memory context (focused prompt, scroll, the edit you were on). The
  // harness already holds the saved values in memory, so no reload is needed.
  server: {
    watch: {
      ignored: [
        path.join(here, '../../src/suggest/triggers.json'),
        path.join(here, '../../tests/fixtures/selection-corpus.json'),
      ],
    },
  },
  plugins: [savePlugin()],
});
