// ============================================================
// save-plugin.ts — dev-server-only Vite middleware for the guidance studio.
//
// `apply: 'serve'` keeps it out of any production build; it is never imported by
// src/index.ts, and tools/ never ships (package.json files: ["dist"]). All
// handlers run SERVER-SIDE in the Vite Node context — never the browser (F12):
//   GET  /coverage        → has-tips/empty per raw TYPE block (35), live from disk
//   GET  /guidance?type=  → the type's current full TIPS block (or a template)
//   POST /guidance        → validated, atomic write-back to language-reference.md
//   GET  /datasets?type=  → manifest entries (filtered to suitsTypes when ?type=)
//   POST /run             → claude -p → renderPipeline → { dgmo, svg, png, … }
//
// The heavy render path is the EXACT shipped one: we dynamic-import the BUILT
// `dist/render-helpers.js` (F13 — built output, not raw ../../src/*.ts), so
// `require.resolve`/font bundling run in plain Node. `pnpm studio` builds first.
// ============================================================
import type { Plugin } from 'vite';
import { writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  validateTipsEdit,
  currentTipsBlock,
  tipsCoverage,
} from './validate-tips';
import { extractSection, extractColorRule } from '../../src/reference';

const TIPS_BLOCK_RE = /<!--\s*TIPS start\s*-->[\s\S]*?<!--\s*TIPS end\s*-->/;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(here, '../..'); // dgmo-mcp/
// Authoring target = the workspace dgmo source (edits are written back here).
const REF_PATH = path.join(here, '../../../dgmo/docs/language-reference.md');
const DATASETS_DIR = path.join(here, 'datasets');
// Target the ESM build (.mjs) explicitly — robust regardless of Node's CJS
// named-export interop. `pnpm studio` runs `pnpm build` first so this exists.
const RENDER_HELPERS_PATH = path.join(REPO_ROOT, 'dist/render-helpers.mjs');
const RENDER_HELPERS = pathToFileURL(RENDER_HELPERS_PATH).href;

type RenderHelpers = typeof import('../../src/render-helpers');
let helpersPromise: Promise<RenderHelpers> | null = null;
/** Load the built render helpers once (dynamic import → plain Node runtime). */
function loadHelpers(): Promise<RenderHelpers> {
  if (!helpersPromise) {
    if (!existsSync(RENDER_HELPERS_PATH))
      throw new Error('dist/render-helpers.mjs missing — run `pnpm build` first');
    helpersPromise = import(RENDER_HELPERS) as Promise<RenderHelpers>;
  }
  return helpersPromise;
}

const EMPTY_TIPS_TEMPLATE =
  '<!-- TIPS start -->\n**Styling tips:** \n<!-- TIPS end -->';

interface Dataset {
  id: string;
  label: string;
  suitsTypes: string[];
  data: unknown;
}

function readManifest(): { id: string; label: string; suitsTypes: string[] }[] {
  const p = path.join(DATASETS_DIR, 'manifest.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

function readDataset(id: string): Dataset | null {
  const p = path.join(DATASETS_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Pull the prose body out of a full TIPS block (anchors stripped). */
function tipsBody(block: string | null): string {
  if (!block) return '';
  return block
    .replace(/<!--\s*TIPS start\s*-->/, '')
    .replace(/<!--\s*TIPS end\s*-->/, '')
    .trim();
}

/** Build the exact prompt sent to the model, so the UI can display it (F2/F6). */
function buildResolvedPrompt(
  type: string,
  userPrompt: string,
  tips: string,
  dataset: Dataset | null,
  reference: string
): string {
  const parts = [
    `Produce a Diagrammo (DGMO) "${type}" diagram for the request below.`,
    'Output ONLY the DGMO source — no prose, no explanation. A ```dgmo fence is fine.',
  ];
  // Mirror real MCP usage: give the model the same per-type syntax reference an
  // agent would fetch via get_language_reference, so generated syntax is
  // faithful and the tips are judged on a realistic base (not naïve syntax).
  if (reference)
    parts.push(`DGMO syntax reference for "${type}":\n${reference}`);
  if (tips) parts.push(`Styling guidance you MUST follow:\n${tips}`);
  if (dataset)
    parts.push(
      `Use EXACTLY this data — do not invent, round, or drop any values:\n` +
        JSON.stringify(dataset.data, null, 2)
    );
  parts.push(`Request: ${userPrompt}`);
  return parts.join('\n\n');
}

/** Extract DGMO source from a claude completion (strip an optional fence). */
function extractDgmo(out: string): string {
  const fence = out.match(/```(?:dgmo)?\s*\n([\s\S]*?)```/);
  return (fence ? fence[1] : out).trim();
}

function runClaude(prompt: string): Promise<{ out: string; error: string | null }> {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', prompt],
      { timeout: 120_000, maxBuffer: 4 << 20 },
      (err, stdout) =>
        resolve({
          out: (stdout || '').trim(),
          error: err ? (err instanceof Error ? err.message : String(err)) : null,
        })
    );
  });
}

function sendJson(res: import('node:http').ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

export function savePlugin(): Plugin {
  return {
    name: 'guidance-studio-save',
    apply: 'serve',
    configureServer(server) {
      // Live coverage — fresh from disk so a save flips the marker immediately.
      server.middlewares.use('/studio/coverage', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const md = readFileSync(REF_PATH, 'utf8');
          sendJson(res, 200, { types: tipsCoverage(md) });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
      });

      // Current TIPS block for a type (or an empty starter template).
      server.middlewares.use('/studio/guidance', (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        if (req.method === 'GET') {
          try {
            const type = url.searchParams.get('type') ?? '';
            const md = readFileSync(REF_PATH, 'utf8');
            const block = currentTipsBlock(md, type);
            sendJson(res, 200, {
              type,
              hasTips: block != null,
              block: block ?? EMPTY_TIPS_TEMPLATE,
            });
          } catch (err) {
            sendJson(res, 500, { error: String(err) });
          }
          return;
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const { type, block } = JSON.parse(body) as {
                type: string;
                block: string;
              };
              const md = readFileSync(REF_PATH, 'utf8');
              const v = validateTipsEdit(md, type, block);
              if (!v.ok || !v.result) {
                sendJson(res, 400, { ok: false, reason: v.reason });
                return;
              }
              // Snapshot to .bak, then write atomically (temp + rename) so a
              // crash mid-write can never leave a truncated reference file.
              writeFileSync(REF_PATH + '.bak', md);
              const tmp = `${REF_PATH}.tmp-${process.pid}`;
              try {
                writeFileSync(tmp, v.result);
                renameSync(tmp, REF_PATH); // atomic on the same filesystem
              } catch (writeErr) {
                try {
                  rmSync(tmp, { force: true });
                } catch {
                  /* best-effort temp cleanup */
                }
                writeFileSync(REF_PATH, md); // restore from in-memory snapshot
                throw writeErr;
              }
              sendJson(res, 200, { ok: true });
            } catch (err) {
              sendJson(res, 400, { ok: false, reason: String(err) });
            }
          });
          return;
        }
        next();
      });

      // Datasets for the dropdown; ?type= filters to suitsTypes (Phase-2 default
      // is applied browser-side, the filter is the data behind it).
      server.middlewares.use('/studio/datasets', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const type = new URL(req.url ?? '', 'http://localhost').searchParams.get(
            'type'
          );
          const all = readManifest();
          const fitting = type
            ? all.filter((d) => d.suitsTypes.includes(type))
            : all;
          sendJson(res, 200, { all, fitting });
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
      });

      // A single dataset's full payload — so the UI can show the literal data
      // that will be injected, before a run.
      server.middlewares.use('/studio/dataset', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get(
            'id'
          );
          const ds = id ? readDataset(id) : null;
          if (!ds) {
            sendJson(res, 404, { error: 'dataset not found' });
            return;
          }
          sendJson(res, 200, ds);
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
      });

      // Pre-rendered gallery (gallery.json) — the persisted DGMO + render for
      // every type × starter prompt, so the UI can show output WITHOUT a live
      // run. Built by build-gallery.mjs; the PNGs are served as static files
      // from the Vite root (/gallery/<type>-<idx>.png).
      server.middlewares.use('/studio/gallery', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const p = path.join(here, 'gallery.json');
          if (!existsSync(p)) {
            sendJson(res, 200, {});
            return;
          }
          sendJson(res, 200, JSON.parse(readFileSync(p, 'utf8')));
        } catch (err) {
          sendJson(res, 500, { error: String(err) });
        }
      });

      // Add a new starter prompt for a type. Appends to prompts.json (so the
      // studio sees it immediately) AND prompts-extra.json (so a build.mjs
      // regen preserves it). New prompts are unvalidated (no gallery render)
      // until validated — the UI flags them.
      server.middlewares.use('/studio/prompts', (req, res, next) => {
        if (req.method !== 'POST') return next();
        readBody(req).then((body) => {
          try {
            const { type, prompt } = JSON.parse(body) as {
              type: string;
              prompt: string;
            };
            if (!type || !prompt || !prompt.trim())
              throw new Error('type and a non-empty prompt are required');
            const text = prompt.trim();
            const promptsPath = path.join(here, 'prompts.json');
            const extraPath = path.join(here, 'prompts-extra.json');
            const prompts = JSON.parse(readFileSync(promptsPath, 'utf8')) as Record<
              string,
              string[]
            >;
            if (!prompts[type]) throw new Error(`unknown chart type: ${type}`);
            if (prompts[type].includes(text)) {
              sendJson(res, 200, { ok: true, prompts: prompts[type], added: false });
              return;
            }
            prompts[type] = [...prompts[type], text];
            writeFileSync(promptsPath, JSON.stringify(prompts, null, 2) + '\n');
            // Mirror to prompts-extra.json (survives build.mjs regeneration).
            const extra = existsSync(extraPath)
              ? (JSON.parse(readFileSync(extraPath, 'utf8')) as Record<string, string[]>)
              : {};
            extra[type] = [...(extra[type] ?? []), text];
            writeFileSync(extraPath, JSON.stringify(extra, null, 2) + '\n');
            sendJson(res, 200, { ok: true, prompts: prompts[type], added: true });
          } catch (err) {
            sendJson(res, 400, { ok: false, reason: String(err) });
          }
        });
      });

      // One run: claude -p → renderPipeline → source + image (+ proof of inputs).
      server.middlewares.use('/studio/run', (req, res, next) => {
        if (req.method !== 'POST') return next();
        readBody(req).then(async (body) => {
          try {
            const {
              type,
              prompt: userPrompt,
              datasetId,
              tips,
            } = JSON.parse(body) as {
              type: string;
              prompt: string;
              datasetId?: string;
              tips?: string;
            };
            if (!type || !userPrompt)
              throw new Error('type and prompt are required');
            const md = readFileSync(REF_PATH, 'utf8');
            // Use the editor's live tips if provided (so a run reflects an
            // unsaved edit — F2), else the on-disk block.
            const injectedTips =
              tips != null ? tips.trim() : tipsBody(currentTipsBlock(md, type));
            const dataset = datasetId ? readDataset(datasetId) : null;
            // Per-type syntax reference (the get_language_reference slice), minus
            // its TIPS block — the live tips are injected separately above, so
            // this avoids double-sending them. Prepend the universal color rule
            // exactly as MCP's sliceWithColorRule does, so a studio run sees the
            // same closed-11-color / no-hex contract a real client gets (else the
            // model invents hex colors the reference never sanctioned).
            const section = (extractSection(md, type) ?? '')
              .replace(TIPS_BLOCK_RE, '')
              .trim();
            const colorRule = extractColorRule(md);
            const reference =
              section && colorRule
                ? `${colorRule}\n\n---\n\n${section}`
                : section;
            const resolvedPrompt = buildResolvedPrompt(
              type,
              userPrompt,
              injectedTips,
              dataset,
              reference
            );
            const { out, error: claudeErr } = await runClaude(resolvedPrompt);
            if (claudeErr && !out) {
              sendJson(res, 200, {
                dgmo: '',
                svg: null,
                pngBase64: null,
                resolvedPrompt,
                injectedTips,
                diagnostics: [],
                error: `claude failed: ${claudeErr}`,
              });
              return;
            }
            const dgmo = extractDgmo(out);
            const helpers = await loadHelpers();
            // renderPipeline parses internally — do NOT parse separately (F4).
            const result = await helpers.renderPipeline(dgmo, {
              theme: 'light',
              palette: 'slate',
            });
            const svg = result.error ? null : result.svg;
            const pngBase64 = svg ? helpers.svgToPngBase64(svg, '#ffffff') : null;
            sendJson(res, 200, {
              dgmo,
              svg,
              pngBase64,
              resolvedPrompt,
              injectedTips,
              diagnostics: result.diagnostics,
              error: result.error,
            });
          } catch (err) {
            sendJson(res, 400, { error: String(err) });
          }
        });
      });
    },
  };
}
