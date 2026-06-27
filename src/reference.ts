// ============================================================
// reference.ts — per-type slicing of the bundled DGMO language reference.
//
// Pure string functions (no fs, no server side effects) so they are unit
// testable in isolation. The slicing is keyed on the `<!-- TYPE:<id> -->`
// anchors and `<!-- TYPE-ALIASES: ... -->` map that live in
// language-reference.md — the SAME single source the dgmo-side generator reads
// (dgmo/scripts/lib/ref-anchors.mjs), so MCP retrieval and core generation can
// never disagree about where a type's block lives.
//
// Replaces the old heading-regex slicer, which failed for every hyphenated id
// (journey-map, boxes-and-lines, tech-radar, …) and every grouped data-chart
// id (F4).
// ============================================================

/**
 * Parse the `<!-- TYPE-ALIASES: a=b c=b ... -->` map. Grouped data-chart /
 * matrix ids (line, pie, raci, …) share another id's documented block.
 */
export function parseTypeAliases(markdown: string): Map<string, string> {
  const m = markdown.match(/<!--\s*TYPE-ALIASES:\s*([^>]*?)-->/);
  const map = new Map<string, string>();
  if (!m) return map;
  for (const pair of m[1].trim().split(/\s+/)) {
    const [alias, target] = pair.split('=');
    if (alias && target) map.set(alias.trim(), target.trim());
  }
  return map;
}

/**
 * Extract the universal color rule (the closed 11-name palette + the explicit
 * "no hex / no CSS color names" guidance) from the language reference. It lives
 * between `<!-- COLORS start -->` / `<!-- COLORS end -->` inside the
 * ANTIPATTERNS block. Returned so per-type slices — which omit the ANTIPATTERNS
 * core — can still carry the color contract for EVERY chart type. Returns null
 * if the markers are absent (older bundled reference).
 */
export function extractColorRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*COLORS start\s*-->([\s\S]*?)<!--\s*COLORS end\s*-->/
  );
  return m ? m[1].trim() : null;
}

/**
 * Extract the universal "always title the diagram" rule (the `<!-- TITLE start -->`
 * / `<!-- TITLE end -->` block inside the STYLING core). Like the color rule, it
 * is prepended to EVERY per-type slice so the model is told to title every
 * diagram regardless of type — the STYLING core itself never rides the slice.
 * Returns null if the markers are absent (older bundled reference).
 */
export function extractTitleRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*TITLE start\s*-->([\s\S]*?)<!--\s*TITLE end\s*-->/
  );
  return m ? m[1].trim() : null;
}

/**
 * Extract the universal "categorize and color by a tag group" rule (the
 * `<!-- CATEGORIZE start -->` / `<!-- CATEGORIZE end -->` block inside the
 * STYLING core). Like the color + title rules it is prepended to EVERY per-type
 * slice so the model is pushed to find a categorization axis and color by it for
 * every diagram. Returns null if the markers are absent (older bundled reference).
 */
export function extractCategorizeRule(markdown: string): string | null {
  const m = markdown.match(
    /<!--\s*CATEGORIZE start\s*-->([\s\S]*?)<!--\s*CATEGORIZE end\s*-->/
  );
  return m ? m[1].trim() : null;
}

/**
 * Slice the per-type block for `chartType`, resolving aliases first. A block
 * runs from just after its `<!-- TYPE:<id> -->` marker to the next TYPE marker
 * or the next `^## ` (H2) heading, whichever comes first. The opening TYPE
 * marker is a purely structural anchor — it is EXCLUDED from the returned slice
 * so it never reaches a consumer (the model would otherwise echo it verbatim as
 * the first line of its generated diagram). Returns null when no anchor resolves
 * (the id has neither a literal marker nor an alias).
 */
export function extractSection(
  markdown: string,
  chartType: string
): string | null {
  const aliases = parseTypeAliases(markdown);
  const resolved = aliases.get(chartType) ?? chartType;
  const startRe = new RegExp(`<!--\\s*TYPE:${resolved}\\s*-->`);
  const startMatch = startRe.exec(markdown);
  if (!startMatch) return null;
  const after = startMatch.index + startMatch[0].length;
  const rest = markdown.slice(after);
  const nextType = rest.search(/<!--\s*TYPE:[a-z0-9-]+\s*-->/);
  const nextH2 = rest.search(/^## /m);
  const ends = [nextType, nextH2].filter((n) => n !== -1);
  const end = ends.length ? after + Math.min(...ends) : markdown.length;
  return markdown.slice(after, end).trim();
}
