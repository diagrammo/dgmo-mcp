// ============================================================
// render-helpers.ts — the parse → render → raster path, single-sourced.
//
// Extracted from index.ts (Story: AI authoring-guidance harness, T2) so the
// dev-only guidance studio middleware can reuse the EXACT render path the
// shipped MCP server uses, without duplicating it. index.ts re-imports these;
// the studio middleware dynamic-imports the BUILT `dist/render-helpers.js`
// (never the raw source — keeps `require.resolve`/font bundling running in
// plain Node, not an esbuild config bundle or the browser; F13).
// ============================================================

import {
  render,
  parseDgmo,
  parseDgmoChartType,
  formatDgmoError,
  loadMapData,
  INVALID_COLOR_CODE,
  textFromSvg,
  uncoveredCharacters,
  fontPortabilityWarning,
  type FontCoverage,
} from '@diagrammo/dgmo/advanced';
import { validateFlowchartStructure } from './flowchart-structure.js';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetRoots } from './asset-roots.js';

const DEFAULT_FONT_NAME = 'Inter';

/**
 * The Inter TTFs resvg rasterises with. They ship in our own `dist/fonts/`,
 * staged there at build time — see src/asset-roots.ts for why this is no longer
 * a `require.resolve('@diagrammo/dgmo')`.
 *
 * Falls back to system fonts if the TTFs aren't found (e.g. in an odd
 * install layout) — resvg will then use whatever sans-serif it finds.
 */
function resolveBundledFonts(): string[] {
  for (const root of assetRoots()) {
    const candidates = [
      join(root, 'fonts', 'Inter-Regular.ttf'),
      join(root, 'fonts', 'Inter-Bold.ttf'),
    ];
    const found = candidates.filter((f) => existsSync(f));
    if (found.length > 0) return found;
  }
  return [];
}

const BUNDLED_FONT_FILES = resolveBundledFonts();

/**
 * The characters the bundled Inter cannot draw, for the caller to report.
 *
 * Returns `undefined` when everything is covered, or when the coverage manifest
 * is missing — an odd install layout is not worth a warning of its own.
 */
export function fontCoverageWarning(svg: string): string | undefined {
  for (const root of assetRoots()) {
    const manifest = join(root, 'fonts', 'coverage.json');
    if (!existsSync(manifest)) continue;
    try {
      const coverage = JSON.parse(
        readFileSync(manifest, 'utf-8')
      ) as FontCoverage;
      return fontPortabilityWarning(
        uncoveredCharacters(textFromSvg(svg), coverage)
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function svgToPngBase64(svg: string, background?: string): string {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom' as const, value: 2 },
    ...(background ? { background } : {}),
    font: {
      // 🔴 Always on, even when the bundled Inter was found. It used to be
      // `BUNDLED_FONT_FILES.length === 0` — system fonts off precisely BECAUSE
      // we had our own — which made the `system-ui, …, sans-serif` tail of the
      // library's FONT_FAMILY inert, so every script Inter lacks drew NOTHING:
      // no box, no warning. Measured 2026-08-07 through the CLI's identical
      // call site, where 日本語 rasterised the same as an unassigned Private
      // Use codepoint. Latin output is byte-identical across the change,
      // because Inter is still loaded explicitly and named as both the default
      // and the sans-serif family.
      loadSystemFonts: true,
      ...(BUNDLED_FONT_FILES.length > 0
        ? { fontFiles: BUNDLED_FONT_FILES }
        : {}),
      defaultFontFamily: DEFAULT_FONT_NAME,
      sansSerifFamily: DEFAULT_FONT_NAME,
    },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng()).toString('base64');
}

// ---------------------------------------------------------------------------
// Render pipeline — the one parse → validate → render → normalize path behind
// every tool (Story 110.3). Tools differ only in how they present the result.
// Palette resolution + its fallback warning stay tool-level (Story 110.2): they
// are a per-request concern, not per-diagram.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input caps — checked on the raw text, before any parse or layout
// (diagrammo/diagrammo#1557). The HTTP body cap (MAX_BODY_BYTES, 4 MiB) was
// the only bound on what a caller could hand the renderer, and stdio had none.
// Layout is synchronous, so a deadline cannot stop it; refusing the input can.
// ---------------------------------------------------------------------------

// The longest line accepted. The inline-markdown link scan in the inlined
// library is super-linear in the length of one line (fixed in dgmo fdcedbf9,
// not yet released into this package). The gallery's longest line is 85.
const MAX_LINE_CHARS = 1000;

// The most nodes and edges accepted, estimated from the text: every non-blank
// line, plus every edge connector in it, since a chain line declares one node
// per connector. Over-counting refuses early, never late. Measured 2026-10-27:
// about 2,000 lines of org, mindmap or sankey render in 1.5 s or less.
const MAX_NODES_AND_EDGES = 2000;
const EDGE_CONNECTOR = /->|~>|<-|=>|-{2,}|\.{2,}/g;

// The most edge connectors accepted in a chart type laid out by dagre (the
// chart types whose dgmo layout imports it). Their layout grows much faster
// than the edge count: measured 2026-10-27 through renderPipeline, a
// boxes-and-lines graph of random edges took 8-10 s at 150 edges, 16 s at 200
// and 71 s at 300. The gallery's most connected fixture has 48.
const MAX_GRAPH_EDGES = 150;
const GRAPH_LAYOUT_TYPES = new Set([
  'boxes-and-lines',
  'c4',
  'class',
  'er',
  'flowchart',
  'infra',
  'pert',
  'sitemap',
  'state',
]);

/** Why a diagram is too large to lay out, or null when it is within the caps. */
export function inputSizeError(dgmo: string): string | null {
  let count = 0;
  let edges = 0;
  const lines = dgmo.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > MAX_LINE_CHARS) {
      return `Line ${i + 1} is ${line.length} characters long; the limit is ${MAX_LINE_CHARS}. Split it or shorten it.`;
    }
    if (line.trim() === '') continue;
    const connectors = line.match(EDGE_CONNECTOR)?.length ?? 0;
    edges += connectors;
    count += 1 + connectors;
    if (count > MAX_NODES_AND_EDGES) {
      return `The diagram has more than ${MAX_NODES_AND_EDGES} nodes and edges (counted to line ${i + 1}). Split it into smaller diagrams.`;
    }
  }
  // Only once every line is within MAX_LINE_CHARS, so the type is read from a
  // bounded first line.
  const chartType = parseDgmoChartType(dgmo);
  if (
    edges > MAX_GRAPH_EDGES &&
    chartType &&
    GRAPH_LAYOUT_TYPES.has(chartType)
  ) {
    return `The ${chartType} diagram has ${edges} edges; the limit for this chart type is ${MAX_GRAPH_EDGES}. Split it into smaller diagrams.`;
  }
  return null;
}

type RenderDiagnostics = ReturnType<typeof parseDgmo>['diagnostics'];

/** Discriminated on `error`: a null error guarantees a non-null svg. */
export type RenderPipelineResult =
  | { svg: string; diagnostics: RenderDiagnostics; error: null }
  | { svg: null; diagnostics: RenderDiagnostics; error: string };

export async function renderPipeline(
  dgmo: string,
  opts: {
    theme: 'light' | 'dark' | 'transparent';
    /** The default palette — a diagram's own `palette` line beats it. */
    palette?: string | undefined;
    /** An explicit caller choice that beats the diagram's own palette. */
    paletteOverride?: string | undefined;
    /**
     * Canvas width in px. Exact for a chart type that lays its content out
     * into the canvas (the data charts); an upper bound for one that fits a
     * finished layout to it. A chart that sizes itself from its own content —
     * org, sitemap, class, er, infra and the rest of the structured family —
     * cannot go below its content and says so in its diagnostics.
     */
    width?: number | undefined;
    /** Canvas height in px. Most chart types derive it from the content. */
    height?: number | undefined;
  }
): Promise<RenderPipelineResult> {
  const tooLarge = inputSizeError(dgmo);
  if (tooLarge !== null) {
    return { svg: null, diagnostics: [], error: tooLarge };
  }
  const { diagnostics } = parseDgmo(dgmo);
  // Flowcharts get an extra structural gate (orphan nodes, one-way decisions);
  // these are warnings in the library but the MCP refuses them so the authoring
  // LLM is forced to produce a valid flow.
  if (parseDgmoChartType(dgmo) === 'flowchart') {
    diagnostics.push(...validateFlowchartStructure(dgmo));
  }
  // Hard gate: block on any error AND on any invalid-color diagnostic, even
  // when the parser classed it a warning (CSS color names like `crimson` are
  // warnings in the library so the app/CLI degrade gracefully, but the MCP
  // refuses them so the authoring LLM is forced to use a named palette color).
  const blocking = diagnostics.filter(
    (d) => d.severity === 'error' || d.code === INVALID_COLOR_CODE
  );
  if (blocking.length > 0) {
    return {
      svg: null,
      diagnostics,
      error: blocking.map(formatDgmoError).join('\n'),
    };
  }
  try {
    const { svg } = await render(dgmo, {
      theme: opts.theme,
      ...(opts.palette !== undefined && { palette: opts.palette }),
      ...(opts.paletteOverride !== undefined && {
        paletteOverride: opts.paletteOverride,
      }),
      // `render()` takes basemaps by dependency injection and draws nothing at
      // all without them — it does not load them itself. Omitting this is why
      // every map chart returned an empty SVG through this path, in every
      // version up to and including 0.19.0: `render_diagram`, `preview_diagram`
      // and `generate_report` all come through here, so the server could not
      // draw a map at all. The CLI passes the same loader (`dgmo/src/cli.ts`).
      // Nothing caught it because no test rendered every chart type.
      mapData: loadMapData,
      ...(opts.width !== undefined && { width: opts.width }),
      ...(opts.height !== undefined && { height: opts.height }),
    });
    if (!svg) {
      return { svg: null, diagnostics, error: 'Render returned empty SVG.' };
    }
    return { svg, diagnostics, error: null };
  } catch (err) {
    return {
      svg: null,
      diagnostics,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The background the renderer actually drew — the root `<svg>`'s
 * `style="background: …"`. Which palette won (the caller's override, the
 * diagram's own `palette` line, or the default) is decided inside `render()`,
 * so the SVG is the one place that knows it. Undefined when it carries none.
 */
export function svgBackground(svg: string): string | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  return /style="[^"]*\bbackground:\s*([^;"]+)/.exec(root)?.[1]?.trim();
}
