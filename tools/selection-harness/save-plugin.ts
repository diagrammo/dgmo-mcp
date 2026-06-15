// Dev-server-only vite middleware: POST /save writes edited vocabulary back to
// src/suggest/triggers.json and the corpus back to tests/fixtures/.
// `apply: 'serve'` keeps it out of any production build; it is never imported by
// src/index.ts, and tools/ never ships (package.json files: ["dist"]).
import type { Plugin } from 'vite';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRIGGERS_PATH = path.join(here, '../../src/suggest/triggers.json');
const CORPUS_PATH = path.join(
  here,
  '../../tests/fixtures/selection-corpus.json'
);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** triggers = Record<id, {phrases:string[], concepts:string[]}>. */
function validateTriggers(t: unknown): void {
  if (!isObject(t)) throw new Error('triggers must be an object');
  for (const [id, entry] of Object.entries(t)) {
    if (!isObject(entry))
      throw new Error(`triggers["${id}"] must be an object`);
    const { phrases, concepts } = entry as Record<string, unknown>;
    if (!Array.isArray(phrases) || !phrases.every((p) => typeof p === 'string'))
      throw new Error(`triggers["${id}"].phrases must be string[]`);
    if (
      !Array.isArray(concepts) ||
      !concepts.every((c) => typeof c === 'string')
    )
      throw new Error(
        `triggers["${id}"].concepts must be string[] (preserve it)`
      );
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
