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

type RenderDiagnostics = ReturnType<typeof parseDgmo>['diagnostics'];

/** Discriminated on `error`: a null error guarantees a non-null svg. */
export type RenderPipelineResult =
  | { svg: string; diagnostics: RenderDiagnostics; error: null }
  | { svg: null; diagnostics: RenderDiagnostics; error: string };

export async function renderPipeline(
  dgmo: string,
  opts: {
    theme: 'light' | 'dark' | 'transparent';
    palette: string;
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
      palette: opts.palette,
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
