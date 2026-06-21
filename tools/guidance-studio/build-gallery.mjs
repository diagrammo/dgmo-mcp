// ============================================================
// build-gallery.mjs — render the committed gallery sources into a browsable
// gallery the studio serves, so every chart type × every starter prompt can be
// inspected (DGMO source + rendered diagram) WITHOUT a live `claude -p` run.
//
//   gallery-sources.json  (committed, the model-authored DGMO per prompt)
//        │   build-gallery.mjs  (this — deterministic render, no LLM)
//        ▼
//   gallery/<type>-<idx>.png  +  gallery.json  (index the studio reads)
//
// Uses the EXACT shipped render path (dist/render-helpers.mjs, theme light /
// palette slate — same as /studio/run) so the gallery image matches a live run.
// Run after `pnpm build`:  node tools/guidance-studio/build-gallery.mjs
// ============================================================
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(here, '../..');
const RENDER_HELPERS = path.join(REPO_ROOT, 'dist/render-helpers.mjs');
if (!existsSync(RENDER_HELPERS)) {
  console.error('dist/render-helpers.mjs missing — run `pnpm build` first.');
  process.exit(1);
}
const { renderPipeline, svgToPngBase64 } = await import(
  pathToFileURL(RENDER_HELPERS).href
);

const prompts = JSON.parse(
  readFileSync(path.join(here, 'prompts.json'), 'utf8')
);
const sources = JSON.parse(
  readFileSync(path.join(here, 'gallery-sources.json'), 'utf8')
);
const validation = JSON.parse(
  readFileSync(path.join(here, 'prompt-validation.json'), 'utf8')
);
const verdictByPrompt = new Map();
for (const [k, v] of Object.entries(validation)) {
  if (k === '_meta') continue;
  for (const e of v) verdictByPrompt.set(e.prompt, e);
}

const OUT_DIR = path.join(here, 'gallery');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const gallery = {
  _meta: {
    builtFrom: 'gallery-sources.json (model-authored DGMO)',
    render: 'theme light, palette slate — same path as /studio/run',
    note: 'Regenerate with `node tools/guidance-studio/build-gallery.mjs` after `pnpm build`.',
  },
};

let ok = 0;
let failed = 0;
for (const type of Object.keys(prompts)) {
  gallery[type] = [];
  for (let idx = 0; idx < prompts[type].length; idx++) {
    const prompt = prompts[type][idx];
    const dgmo = sources[type]?.[idx] ?? '';
    let imgFile = null;
    let renderError = null;
    try {
      const result = await renderPipeline(dgmo, {
        theme: 'light',
        palette: 'slate',
      });
      if (result.error || !result.svg) {
        renderError = result.error ?? 'no svg';
      } else {
        const png = svgToPngBase64(result.svg, '#ffffff');
        imgFile = `${type}-${idx}.png`;
        writeFileSync(path.join(OUT_DIR, imgFile), Buffer.from(png, 'base64'));
      }
    } catch (err) {
      renderError = String(err);
    }
    const verdict = verdictByPrompt.get(prompt);
    gallery[type].push({
      idx,
      prompt,
      dgmo,
      img: imgFile,
      valid: verdict?.valid ?? false,
      intent: verdict?.intent ?? 'unknown',
      render: imgFile ? 'ok' : 'fail',
      error: renderError,
    });
    if (imgFile) ok++;
    else {
      failed++;
      console.warn(`  ✗ ${type}[${idx}] render failed: ${renderError}`);
    }
  }
}

writeFileSync(
  path.join(here, 'gallery.json'),
  JSON.stringify(gallery, null, 2) + '\n'
);

console.log(
  `[gallery] rendered ${ok} prompts (${failed} failed) → gallery/*.png + gallery.json`
);
