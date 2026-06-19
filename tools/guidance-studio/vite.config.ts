import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { savePlugin } from './save-plugin';

const here = path.dirname(fileURLToPath(import.meta.url));

// The studio writes back to the dgmo SOURCE language-reference.md (a file
// outside this Vite root). Don't watch it — a save shouldn't trigger a page
// reload that wipes the in-memory edit/run state. The middleware re-reads it
// fresh from disk on every /guidance + /coverage request, so no reload is
// needed. (Same reasoning as the selection-harness ignoring triggers.json.)
export default defineConfig({
  root: here,
  server: {
    watch: {
      ignored: [path.join(here, '../../../dgmo/docs/language-reference.md')],
    },
  },
  plugins: [savePlugin()],
});
