// Dev-server-only vite middleware: POST /save writes edited vocabulary back to
// src/suggest/triggers.json and the corpus back to tests/fixtures/.
// `apply: 'serve'` keeps it out of any production build; it is never imported by
// src/index.ts, and tools/ never ships (package.json files: ["dist"]).
import type { Plugin } from 'vite';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { judgeAll } from './judge-engine';

const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

/** Run a whitelisted pnpm script in the dgmo-mcp repo root and resolve its
 *  combined output + exit code. Whitelisted (`test`/`build`) so the dev-only
 *  endpoint can never run arbitrary commands. */
function runPnpm(
  cmd: 'test' | 'build'
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      'pnpm',
      [cmd],
      { cwd: REPO_ROOT, timeout: 300_000, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`.trim();
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ code, output });
      }
    );
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const TRIGGERS_PATH = path.join(here, '../../src/suggest/triggers.json');
const CORPUS_PATH = path.join(
  here,
  '../../tests/fixtures/selection-corpus.json'
);
// Chart-type descriptions: the harness reads the dumped registry.json (also what
// the browser scorer resolves via the shim); the REAL product source is dgmo's
// chart-types.ts. Save writes both — registry.json drives the live loop, the
// dgmo patch lands the win in the product (applies to the scorer after a dgmo
// release; the LLM judge uses the text directly, so it's live immediately).
const REGISTRY_PATH = path.join(here, 'registry.json');
const DGMO_CHARTTYPES_PATH = path.join(here, '../../../dgmo/src/chart-types.ts');

/** Read the dumped registry → {id: description}. */
function readDescriptions(): { descriptions: Record<string, string>; ids: string[] } {
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as {
    id: string;
    description: string;
  }[];
  const descriptions: Record<string, string> = {};
  for (const r of reg) descriptions[r.id] = r.description;
  return { descriptions, ids: reg.map((r) => r.id) };
}

const quoteTs = (s: string): string =>
  "'" + s.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/** Patch each `id: '<id>', description: '<old>'` literal in dgmo/src/chart-types.ts
 *  with the edited description. Whitespace/newlines in the capture are preserved,
 *  so the file's formatting (incl. the multi-line description entries) is kept. */
function patchDgmoDescriptions(descriptions: Record<string, string>): {
  patched: string[];
  skipped: string[];
} {
  if (!existsSync(DGMO_CHARTTYPES_PATH))
    return { patched: [], skipped: Object.keys(descriptions) };
  let text = readFileSync(DGMO_CHARTTYPES_PATH, 'utf8');
  const patched: string[] = [];
  const skipped: string[] = [];
  for (const [id, desc] of Object.entries(descriptions)) {
    const re = new RegExp(
      `(id:\\s*'${id}'\\s*,\\s*description:\\s*)('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`
    );
    if (!re.test(text)) {
      skipped.push(id);
      continue;
    }
    text = text.replace(re, (_full, g1: string) => g1 + quoteTs(desc));
    patched.push(id);
  }
  // Sanity guard: never write a file that lost its registry export.
  if (!text.includes('export const chartTypes'))
    throw new Error('chart-types.ts patch would corrupt the registry export');
  writeFileSync(DGMO_CHARTTYPES_PATH, text);
  return { patched, skipped };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** triggers = Record<id, {phrases:string[], concepts:string[]}>. */
function validateTriggers(t: unknown): void {
  if (!isObject(t)) throw new Error('triggers must be an object');
  for (const [id, entry] of Object.entries(t)) {
    if (!isObject(entry))
      throw new Error(`triggers["${id}"] must be an object`);
    const { phrases, concepts, prior } = entry as Record<string, unknown>;
    if (!Array.isArray(phrases) || !phrases.every((p) => typeof p === 'string'))
      throw new Error(`triggers["${id}"].phrases must be string[]`);
    if (
      !Array.isArray(concepts) ||
      !concepts.every((c) => typeof c === 'string')
    )
      throw new Error(
        `triggers["${id}"].concepts must be string[] (preserve it)`
      );
    if (
      prior !== undefined &&
      (typeof prior !== 'number' || !Number.isInteger(prior) || prior < 0)
    )
      throw new Error(`triggers["${id}"].prior must be a non-negative integer`);
  }
}

/** corpus = { baseline:number, cases:[{prompt:string, accept:string[]}], ... }. */
function validateCorpus(c: unknown): void {
  if (!isObject(c)) throw new Error('corpus must be an object');
  if (typeof c.baseline !== 'number')
    throw new Error('corpus.baseline must be a number');
  if (!Array.isArray(c.cases) || c.cases.length === 0)
    throw new Error('corpus.cases must be a non-empty array');
  for (const [i, k] of c.cases.entries()) {
    if (!isObject(k) || typeof k.prompt !== 'string')
      throw new Error(`corpus.cases[${i}].prompt must be a string`);
    if (
      !Array.isArray(k.accept) ||
      !k.accept.every((a) => typeof a === 'string')
    )
      throw new Error(`corpus.cases[${i}].accept must be string[]`);
  }
}

export function savePlugin(): Plugin {
  return {
    name: 'selection-harness-save',
    apply: 'serve',
    configureServer(server) {
      // Load the current vocab + corpus FRESH from disk on every request. The
      // harness fetches this instead of importing the JSON as a Vite module, so
      // a page reload never serves a stale cached snapshot (which silently
      // reverted saved edits in the UI).
      server.middlewares.use('/data', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const triggers = JSON.parse(readFileSync(TRIGGERS_PATH, 'utf8'));
          const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ triggers, corpus }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      // Judge: chart-type descriptions to edit (fresh from the dump).
      server.middlewares.use('/descriptions', (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(readDescriptions()));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // Judge: run the LLM selection judge over prompts with edited descriptions.
      server.middlewares.use('/judge', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { descriptions, prompts } = JSON.parse(body) as {
              descriptions: Record<string, string>;
              prompts: string[];
            };
            if (typeof descriptions !== 'object' || !descriptions)
              throw new Error('descriptions must be an object');
            if (!Array.isArray(prompts)) throw new Error('prompts must be an array');
            const ids = Object.keys(descriptions);
            const verdicts = await judgeAll(descriptions, prompts, ids);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, verdicts }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });

      // Judge: persist edited descriptions → registry.json (live loop) + dgmo
      // chart-types.ts (real product source).
      server.middlewares.use('/save-descriptions', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { descriptions } = JSON.parse(body) as {
              descriptions: Record<string, string>;
            };
            if (typeof descriptions !== 'object' || !descriptions)
              throw new Error('descriptions must be an object');
            for (const [id, d] of Object.entries(descriptions))
              if (typeof d !== 'string' || !d.trim())
                throw new Error(`descriptions["${id}"] must be a non-empty string`);
            // registry.json keeps id/fallback; only descriptions change.
            const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as {
              id: string;
              description: string;
              fallback?: true;
            }[];
            for (const r of reg)
              if (descriptions[r.id]) r.description = descriptions[r.id];
            writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
            const dgmo = patchDgmoDescriptions(descriptions);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, dgmo }));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });

      // Run `pnpm test` (verify the gate) or `pnpm build` (apply edits to the
      // live MCP tool's dist) from the page, so the post-save terminal steps are
      // one click. Whitelisted command only; never runs arbitrary input.
      server.middlewares.use('/run', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { cmd } = JSON.parse(body) as { cmd?: string };
            if (cmd !== 'test' && cmd !== 'build')
              throw new Error("cmd must be 'test' or 'build'");
            const { code, output } = await runPnpm(cmd);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: code === 0, code, output }));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });

      server.middlewares.use('/save', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { triggers, corpus } = JSON.parse(body) as {
              triggers: unknown;
              corpus: unknown;
            };
            // Validate shape before clobbering committed source files: a
            // malformed payload (null, missing key → `undefined`) would
            // otherwise corrupt triggers.json / the corpus fixture.
            validateTriggers(triggers);
            validateCorpus(corpus);
            writeFileSync(
              TRIGGERS_PATH,
              JSON.stringify(triggers, null, 2) + '\n'
            );
            writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2) + '\n');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}
