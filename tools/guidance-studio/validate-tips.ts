// ============================================================
// validate-tips.ts — the write-back guard for guidance-studio tip edits.
//
// TIPS blocks ship to every MCP client via the per-type slice, so a corrupt
// edit to language-reference.md has real blast radius. This is the F4 guard:
// it is deliberately NOT `gen-ai-core` (which never reads per-type TIPS, so
// round-tripping it would validate nothing — Decision 6). Pure string functions
// (no fs) so they unit-test in isolation and run identically in the dev-server
// middleware.
//
// `extractSection` boundary logic is shared with the MCP slicer (reference.ts):
// a TYPE block runs from its `<!-- TYPE:id -->` marker to the next TYPE marker
// or `^## ` H2. The crucial F10 check: after splicing, the TIPS pair must land
// WITHIN that sliced block — otherwise it silently never reaches MCP.
// ============================================================

import { parseTypeAliases, extractSection } from '../../src/reference.js';

const TIPS_RE = /<!--\s*TIPS start\s*-->[\s\S]*?<!--\s*TIPS end\s*-->/;

export interface TipsEditResult {
  ok: boolean;
  reason?: string;
  /** The full new markdown when ok — what the caller writes to disk. */
  result?: string;
}

interface BlockRange {
  /** Index just after the `<!-- TYPE:id -->` marker. */
  markerEnd: number;
  /** Index where the block ends (next TYPE marker or H2, or EOF). */
  end: number;
}

/** Locate a chart type's TYPE block in the markdown, resolving aliases first. */
function typeBlockRange(md: string, type: string): BlockRange | null {
  const resolved = parseTypeAliases(md).get(type) ?? type;
  const startMatch = new RegExp(`<!--\\s*TYPE:${resolved}\\s*-->`).exec(md);
  if (!startMatch) return null;
  const markerEnd = startMatch.index + startMatch[0].length;
  const rest = md.slice(markerEnd);
  const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
  const nextH2 = rest.search(/^## /m);
  const ends = [nextType, nextH2].filter((n) => n !== -1);
  const end = ends.length ? markerEnd + Math.min(...ends) : md.length;
  return { markerEnd, end };
}

/**
 * Splice `newBlock` (a full `<!-- TIPS start -->…<!-- TIPS end -->` block) into
 * `type`'s block, replacing any existing TIPS and otherwise inserting right
 * after the TYPE marker (top of the block — matches the worked examples). Throws
 * if the type has no block. Pure; returns the new markdown.
 */
export function applyTipsEdit(md: string, type: string, newBlock: string): string {
  const range = typeBlockRange(md, type);
  if (!range) throw new Error(`no TYPE block resolves for "${type}"`);
  const head = md.slice(0, range.markerEnd);
  const blockBody = md.slice(range.markerEnd, range.end);
  const tail = md.slice(range.end);
  const withoutTips = blockBody.replace(TIPS_RE, '');
  const restTrimmed = withoutTips.replace(/^\s+/, '');
  return `${head}\n\n${newBlock.trim()}\n\n${restTrimmed}${tail}`;
}

/**
 * Validate a proposed full TIPS block for `type`, returning the spliced markdown
 * when it passes. Rejects: malformed/unbalanced anchors, empty body, any ```
 * fence (matches both worked examples; keeps the language-reference fence gate
 * clean), unknown type, and — crucially (F10) — a TIPS pair that does not land
 * within the sliced TYPE block.
 */
export function validateTipsEdit(
  md: string,
  type: string,
  newBlock: string
): TipsEditResult {
  const starts = (newBlock.match(/<!--\s*TIPS start\s*-->/g) ?? []).length;
  const ends = (newBlock.match(/<!--\s*TIPS end\s*-->/g) ?? []).length;
  if (starts !== 1 || ends !== 1) {
    return {
      ok: false,
      reason: `TIPS anchors must appear exactly once each (found ${starts} start, ${ends} end)`,
    };
  }
  const inner = newBlock.match(TIPS_RE)?.[0];
  if (!inner) {
    return { ok: false, reason: 'TIPS end marker must follow TIPS start marker' };
  }
  const body = inner
    .replace(/<!--\s*TIPS start\s*-->/, '')
    .replace(/<!--\s*TIPS end\s*-->/, '')
    .trim();
  if (!body) {
    return { ok: false, reason: 'TIPS body is empty' };
  }
  if (/```/.test(newBlock)) {
    return {
      ok: false,
      reason: 'TIPS must not contain a ``` code fence (use inline `code` only)',
    };
  }

  let result: string;
  try {
    result = applyTipsEdit(md, type, newBlock);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  // F10: the spliced TIPS must fall inside the sliced TYPE block, or it never
  // reaches the MCP per-type slice.
  const sliced = extractSection(result, type) ?? '';
  if (!TIPS_RE.test(sliced)) {
    return {
      ok: false,
      reason: 'TIPS block does not land within the sliced TYPE block (stray H2 or TYPE marker?)',
    };
  }
  return { ok: true, result };
}

/** Extract the current full TIPS block for a type, or null if it has none. */
export function currentTipsBlock(md: string, type: string): string | null {
  const sliced = extractSection(md, type);
  if (!sliced) return null;
  return sliced.match(TIPS_RE)?.[0] ?? null;
}

/** Has-tips/empty marker per raw `<!-- TYPE:id -->` block (the 35 coverage unit). */
export function tipsCoverage(md: string): { type: string; hasTips: boolean }[] {
  const out: { type: string; hasTips: boolean }[] = [];
  const re = /<!--\s*TYPE:([a-z0-9-]+)\s*-->/g;
  const markers: { id: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    markers.push({ id: m[1], index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].end;
    const rest = md.slice(start);
    const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
    const nextH2 = rest.search(/^## /m);
    const ends = [nextType, nextH2].filter((n) => n !== -1);
    const blockEnd = ends.length ? start + Math.min(...ends) : md.length;
    const block = md.slice(start, blockEnd);
    out.push({ type: markers[i].id, hasTips: TIPS_RE.test(block) });
  }
  return out;
}
