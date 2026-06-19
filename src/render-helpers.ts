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
  formatDgmoError,
  INVALID_COLOR_CODE,
} from '@diagrammo/dgmo/advanced';
import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_FONT_NAME = 'Inter';

/**
 * dgmo bundles Inter TTFs under its `fonts/` directory (see dgmo/src/cli.ts
 * for the same pattern). Resolving them through `require.resolve` ensures
 * we pick up the bundled copy whether @diagrammo/dgmo is installed from npm
 * or linked from the local workspace.
 *
 * Falls back to system fonts if the TTFs aren't found (e.g. in an odd
 * install layout) — resvg will then use whatever sans-serif it finds.
 */
function resolveBundledFonts(): string[] {
  try {
    const dgmoMain = require.resolve('@diagrammo/dgmo');
    const pkgRoot = dirname(dirname(dgmoMain));
    const candidates = [
      join(pkgRoot, 'fonts', 'Inter-Regular.ttf'),
      join(pkgRoot, 'fonts', 'Inter-Bold.ttf'),
    ];
    return candidates.filter((f) => existsSync(f));
  } catch {
    return [];
  }
}

const BUNDLED_FONT_FILES = resolveBundledFonts();

export function svgToPngBase64(svg: string, background?: string): string {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom' as const, value: 2 },
    ...(background ? { background } : {}),
    font: {
      loadSystemFonts: BUNDLED_FONT_FILES.length === 0,
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
  opts: { theme: 'light' | 'dark' | 'transparent'; palette: string }
): Promise<RenderPipelineResult> {
  const { diagnostics } = parseDgmo(dgmo);
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
