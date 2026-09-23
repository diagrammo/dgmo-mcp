// LLM selection-judge engine (dev-server only). Given an EDITABLE chart-type
// description catalog (the real product `chartTypes[].description` text), it asks
// `claude -p` to pick the best type for each corpus prompt — measuring whether
// our *guidance* (not the deterministic scorer) leads an LLM to the right chart.
// No Anthropic API key is used: we shell out to the `claude` CLI (subscription).
//
// Results are cached by hash(catalog + prompt) so re-running after editing one
// description only re-judges what actually changed, and a small concurrency pool
// keeps a full-corpus run to ~1 min instead of serial minutes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface JudgeVerdict {
  prompt: string;
  pick: string;
  reason: string;
}

/** id → description map → the catalog block the LLM sees. Stable order = stable
 *  cache key, so we sort by id. */
export function buildCatalog(descriptions: Record<string, string>): string {
  return Object.keys(descriptions)
    .sort()
    .map((id) => `- ${id}: ${descriptions[id]}`)
    .join('\n');
}

/** The judge prompt. The catalog (editable descriptions) is the tunable lever;
 *  the framing around it is fixed. */
export function judgePrompt(catalog: string, prompt: string): string {
  return `You are selecting the single best chart type for a diagramming request.
Choose strictly from this catalog of available chart types (id: description):
${catalog}

Request: "${prompt}"

End your reply with exactly one final line, which the harness parses:
PICK: <id> — <at most 8 word reason>
Use a single id from the catalog. Example:
PICK: bar — one metric across discrete categories`;
}

/** Extract a valid chart-type id + reason from a free-form LLM reply.
 *  The model may reason out loud and even self-correct ("flowchart… Wait, it's a
 *  loop. cycle — …"), so we trust its EXPLICIT final answer line first:
 *    1. The last `PICK: <id> — <reason>` line (the prompt asks for this).
 *    2. Fallback (no PICK line): the LAST valid id mentioned, not the first —
 *       a self-correction puts the final choice last.
 *  A reply with no real id yields pick='' (rendered as ∅) — never a fake type. */
export function parseVerdict(
  raw: string,
  idSet: Set<string>
): { pick: string; reason: string } {
  const tokens = (s: string): string[] =>
    s.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  const pickValidId = (segment: string): string =>
    // Prefer an id in the part before the dash; else anywhere in the segment.
    (() => {
      const sep = segment.search(/\s[—–-]+\s|:/);
      const head = sep >= 0 ? segment.slice(0, sep) : segment;
      return (
        tokens(head).find((t) => idSet.has(t)) ??
        tokens(segment).find((t) => idSet.has(t)) ??
        ''
      );
    })();

  // 1. Explicit "PICK: …" final line (last one wins over any self-correction).
  const pickLines = [...raw.matchAll(/pick:\s*(.+)/gi)].map((m) => m[1]);
  let segment = pickLines.length ? pickLines[pickLines.length - 1] : '';
  let pick = segment ? pickValidId(segment) : '';

  // 2. Fallback: no marker — take the LAST valid id mentioned anywhere.
  if (!pick) {
    const all = tokens(raw).filter((t) => idSet.has(t));
    pick = all[all.length - 1] ?? '';
    if (!segment) segment = raw;
  }

  const sep = segment.search(/\s[—–-]+\s|:/);
  let reason = (sep >= 0 ? segment.slice(sep + 1) : '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[\s—–:-]+/, '')
    .trim();
  if (!reason && !pick) reason = raw.replace(/[\r\n]+/g, ' ').trim();
  return { pick, reason: reason.slice(0, 120) };
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'claude',
      [
        '-p',
        prompt,
        '--tools',
        '',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--effort',
        'low',
      ],
      { timeout: 120_000, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? '' : (stdout || '').trim())
    );
  });
}

// Cache the RAW claude output (the expensive part) keyed by catalog+prompt, and
// re-parse every call — so a parser fix corrects cached verdicts without
// re-calling the LLM.
const rawCache = new Map<string, string>();
const keyFor = (catalog: string, prompt: string): string =>
  createHash('sha256')
    .update(catalog)
    .update('\0')
    .update(prompt)
    .digest('hex');

/** Judge `prompts` against the given description catalog. Cached + concurrency-
 *  limited. `ids` is the valid id set (for parsing/validation). */
export async function judgeAll(
  descriptions: Record<string, string>,
  prompts: string[],
  ids: string[],
  concurrency = 6
): Promise<JudgeVerdict[]> {
  const catalog = buildCatalog(descriptions);
  const idSet = new Set(ids);
  const queue = [...prompts];
  const out: JudgeVerdict[] = [];

  async function worker(): Promise<void> {
    while (queue.length) {
      const prompt = queue.shift()!;
      const ck = keyFor(catalog, prompt);
      let raw = rawCache.get(ck);
      if (raw === undefined) {
        raw = await runClaude(judgePrompt(catalog, prompt));
        rawCache.set(ck, raw);
      }
      out.push({ prompt, ...parseVerdict(raw, idSet) });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, prompts.length || 1) }, worker)
  );
  // Preserve input order (workers race).
  const byPrompt = new Map(out.map((v) => [v.prompt, v]));
  return prompts.map((p) => byPrompt.get(p)!).filter(Boolean);
}
